// ======================================================
// COLEÇÃO EM UM ÚNICO ARQUIVO JSON NA VERCEL BLOB
//
// Por quê: no plano gratuito, a Blob permite só 2.000 "operações avançadas" por mês
// (put, list, del, copy), mas 10.000 "simples" (get/head). Listar arquivos a cada
// atualização de tela esgotava o limite avançado em poucos dias.
//
// Como funciona:
// - Cada coleção é um arquivo JSON ({ itens: [...] }).
// - Leitura: um get (operação simples).
// - Escrita: lê, altera e grava com ifMatch (ETag). Se outra pessoa gravou no meio,
//   a Blob recusa e tentamos de novo — nenhum envio se perde.
// ======================================================

let blobSdk = null;
let blobAccess = null; // "private" ou "public", descoberto no primeiro acesso
const sdk = async () => (blobSdk ||= await import("@vercel/blob"));
const ordemAcesso = () =>
  blobAccess ? [blobAccess] : [...new Set([process.env.ELOGIOS_BLOB_ACCESS || "private", "public"])];
const erroDeAcesso = (e) => /access|private|public/i.test(String(e?.message));
const conflito = (e) =>
  e?.name === "BlobPreconditionFailedError" ||
  e?.constructor?.name === "BlobPreconditionFailedError" ||
  /precondition|already exists|etag/i.test(String(e?.message));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// "Arquivo ainda não existe" (a mensagem/nome mudou entre versões da @vercel/blob:
// hoje vem "The requested blob does not exist").
const naoExiste = (e) =>
  e?.name === "BlobNotFoundError" ||
  e?.constructor?.name === "BlobNotFoundError" ||
  /not.?found|does not exist|no such blob/i.test(String(e?.message));

const semAspas = (t) => String(t || "").replace(/^W\//, "").replace(/"/g, "");

// Última versão lida de cada arquivo (por instância). Se o head mostra a mesma versão,
// devolvemos a cópia guardada e pulamos o get: cada leitura passa de 2 operações simples para 1.
const versoes = new Map(); // pathname -> { etag, json, at }
// Economia (20/10): a mesma instancia confia na copia guardada por alguns segundos sem
// perguntar a Blob de novo (cada pergunta e uma operacao "simples"). Gravacoes sempre
// conferem a versao atual, entao nada se perde; outra pessoa so ve uma mudanca alguns
// segundos depois. Ajustavel por BLOB_CACHE_S (0 desliga).
const CACHE_MS = Math.max(0, Number(process.env.BLOB_CACHE_S ?? 30)) * 1000;
const copia = (json) => (json == null ? null : JSON.parse(json));

// Leitura sempre da versão atual.
// Em produção vimos o get devolver uma cópia antiga (cache), e aí a gravação com ifMatch
// era recusada em todas as tentativas ("Precondition failed") — por isso apagar não funcionava.
// Agora: o head (consulta direta à API, sem cache) diz qual é a versão atual (ETag);
// o get pede o arquivo com essa versão na URL (endereço novo = sem cópia velha) e confere
// se veio mesmo a versão certa. Head e get são operações "simples" no plano gratuito.
async function lerBlob(pathname, { fresco = false } = {}) {
  const recente = versoes.get(pathname);
  if (!fresco && recente && CACHE_MS && Date.now() - recente.at < CACHE_MS) {
    return { data: copia(recente.json), etag: recente.etag };
  }
  const m = await sdk();
  if (typeof m.head !== "function") return lerBlobDireto(pathname);
  let h;
  try {
    h = await m.head(pathname);
  } catch (e) {
    if (naoExiste(e)) return { data: null, etag: null };
    throw e;
  }
  const atual = semAspas(h.etag);
  const guardada = versoes.get(pathname);
  if (atual && guardada && guardada.etag === atual) {
    guardada.at = Date.now();
    return { data: copia(guardada.json), etag: h.etag };
  }
  for (let i = 0; i < 5; i++) {
    const u = new URL(h.url);
    u.searchParams.set("v", atual || String(Date.now()));
    if (i) u.searchParams.set("t", String(Date.now()));
    let r;
    try {
      r = await lerBlobDireto(u.toString());
    } catch (e) {
      if (i === 4) throw e;
      await espera(200 * (i + 1));
      continue;
    }
    // Usa sempre o ETag do head (o "oficial" da API). O que vem no get pode vir em outro
    // formato (ex.: W/"..." pela CDN) e aí o ifMatch nunca bate.
    if (!atual || !r.etag || semAspas(r.etag) === atual) {
      if (atual) versoes.set(pathname, { etag: atual, json: JSON.stringify(r.data), at: Date.now() });
      return { data: r.data, etag: h.etag || r.etag };
    }
    await espera(200 * (i + 1));
  }
  throw new Error("A Blob ainda está devolvendo uma versão antiga do arquivo. Tente de novo em alguns segundos.");
}

async function lerBlobDireto(pathname) {
  const { get } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      const r = await get(pathname, { access, useCache: false });
      blobAccess = access;
      if (!r || !r.stream) return { data: null, etag: null };
      return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob?.etag || null };
    } catch (e) {
      if (naoExiste(e)) return { data: null, etag: null };
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

async function gravarBlob(pathname, data, etag) {
  const { put } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      await put(pathname, JSON.stringify(data), {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      blobAccess = access;
      return;
    } catch (e) {
      ultimo = e;
      if (!erroDeAcesso(e) || conflito(e)) throw e;
    }
  }
  throw ultimo;
}

/** Lê o documento (ou null se ainda não existir). */
async function lerDocBlob(pathname) {
  return (await lerBlob(pathname)).data;
}

/**
 * Altera o documento com segurança contra gravações simultâneas.
 * `fn(atual)` recebe o documento atual (ou null) e devolve o novo.
 */
async function atualizarDocBlob(pathname, fn, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    const { data, etag } = await lerBlob(pathname, { fresco: true });
    const novo = fn(data);
    try {
      await gravarBlob(pathname, novo, etag);
      versoes.delete(pathname);
      return novo;
    } catch (e) {
      if (!conflito(e)) throw e;
      console.warn(`Blob: versão mudou ao gravar ${pathname} (tentativa ${i + 1}, etag ${etag}).`);
      await espera(80 + Math.random() * 220 * (i + 1));
    }
  }
  // Plano B: a Blob continuou recusando a versão. Relê a versão atual e grava por cima.
  // A equipe é pequena e os envios são raros, então o risco de duas gravações no mesmo
  // instante é mínimo — e é melhor do que a pessoa não conseguir enviar ou apagar.
  const { data } = await lerBlob(pathname, { fresco: true });
  const novo = fn(data);
  await gravarDocDiretoBlob(pathname, novo);
  versoes.delete(pathname);
  console.warn(`Blob: ${pathname} gravado sem conferência de versão (plano B).`);
  return novo;
}

/**
 * Grava o documento inteiro sem conferir a versão (o último a gravar vence).
 * Para documentos com um só "dono" que podem ser substituídos sem perda (ex.: análise da semana).
 */
async function gravarDocDiretoBlob(pathname, data) {
  versoes.delete(pathname);
  const { put } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      await put(pathname, JSON.stringify(data), {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        allowOverwrite: true,
      });
      blobAccess = access;
      return;
    } catch (e) {
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

/** Lista os documentos de uma "pasta" (operação avançada: use só em telas raras). */
async function listarDocsBlob(prefix) {
  const { list } = await sdk();
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/** Apaga documentos (operação avançada). */
async function apagarDocsBlob(pathnames) {
  if (!pathnames.length) return;
  for (const p of pathnames) versoes.delete(p);
  const { del } = await sdk();
  for (let i = 0; i < pathnames.length; i += 500) await del(pathnames.slice(i, i + 500));
}

// ======================================================
// DOCUMENTOS NO UPSTASH REDIS (desde 20/10/2026)
//
// Por quê: a Blob gratuita tem só 2.000 operações avançadas por mês e cada envio
// (elogio, sentimento, recado...) é uma. O Redis gratuito tem 500 mil comandos/mês.
// As FOTOS do álbum continuam na Blob (gravarArquivo/lerArquivo).
//
// - Liga sozinho quando o projeto tem as variáveis do Upstash (TOCA_KV_KV_REST_API_URL/TOKEN).
//   TOCA_STORAGE=blob volta ao modo antigo.
// - Produção usa as chaves "toca:"; pré-visualizações usam "toca-preview:" (não mexem na produção).
// - Migração: na primeira vez, copia cada documento da Blob para o Redis (sem apagar da Blob).
//   Documento ainda não copiado é buscado na Blob na hora (e copiado).
// - Gravação segura: cada documento tem um número de versão; a gravação só vale se a
//   versão não mudou (script Lua atômico). Se mudou, relê e tenta de novo.
// ======================================================

const envRedis = () => ({
  url: String(
    process.env.TOCA_KV_KV_REST_API_URL || process.env.TOCA_KV_REST_API_URL ||
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ""
  ).replace(/\/$/, ""),
  token:
    process.env.TOCA_KV_KV_REST_API_TOKEN || process.env.TOCA_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
});
let redisFetch = (...a) => fetch(...a);
export function usaRedis() {
  const { url, token } = envRedis();
  return Boolean(url && token) && String(process.env.TOCA_STORAGE || "").toLowerCase() !== "blob";
}
const prefixo = () =>
  process.env.TOCA_REDIS_PREFIX ||
  (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? "toca-preview:" : "toca:");
const kDoc = (p) => `${prefixo()}d:${p}`;
const kVer = (p) => `${prefixo()}v:${p}`;

async function redis(cmds) {
  const { url, token } = envRedis();
  const r = await redisFetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis respondeu ${r.status}`);
  const out = await r.json();
  for (const x of out) if (x && x.error) throw new Error(`Redis: ${x.error}`);
  return out.map((x) => x.result);
}

// JSON só com ASCII: acentos e emojis viram \uXXXX (no site de promoções, emojis
// chegavam embaralhados pela API REST sem isso).
const paraGuardar = (v) =>
  JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// Documentos conhecidos (para a cópia inicial sem precisar "listar" a Blob, que custa
// operação avançada). Semanas: da 36 à próxima.
function documentosConhecidos() {
  const fixos = [
    "elogios/_dados.json", "elogios-config/_config.json", "sugestoes/_dados.json", "perguntas/_dados.json",
    "lembretes/vapid.json", "lembretes/inscricoes.json", "album/_dados.json", "recado/_dados.json",
    "gestora/_senha.json", "time/_dados.json", "desafios/_dados.json",
  ];
  const semanas = [];
  const hoje = new Date();
  for (let d = new Date(Date.UTC(2026, 7, 31)); d <= new Date(hoje.getTime() + 7 * 86400000); d = new Date(d.getTime() + 7 * 86400000)) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dia = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dia);
    const ano = t.getUTCFullYear();
    const sem = Math.ceil(((t - Date.UTC(ano, 0, 1)) / 86400000 + 1) / 7);
    const s = `${ano}-W${String(sem).padStart(2, "0")}`;
    if (!semanas.includes(s)) semanas.push(s);
  }
  return [...fixos, ...semanas.flatMap((s) => [`sentimentos/${s}.json`, `analises-sentimento/${s}.json`])];
}

let migracao = null; // Promise da cópia inicial (uma por instância)
async function copiarDaBlob(pathname) {
  const { data } = await lerBlob(pathname, { fresco: true });
  if (data == null) return null;
  await redis([["SET", kDoc(pathname), paraGuardar(data), "NX"], ["SET", kVer(pathname), "1", "NX"]]);
  return data;
}
async function garantirMigracao() {
  if (!migracao) {
    migracao = (async () => {
      const [feita] = await redis([["GET", `${prefixo()}migrado`]]);
      if (feita) return true;
      let copiados = 0, falhas = 0;
      for (const p of documentosConhecidos()) {
        try {
          const [ja] = await redis([["EXISTS", kDoc(p)]]);
          if (Number(ja)) continue;
          if ((await copiarDaBlob(p)) != null) copiados++;
        } catch (e) {
          falhas++;
          console.error(`Migração: falha ao copiar ${p}:`, e?.message);
        }
      }
      if (!falhas) await redis([["SET", `${prefixo()}migrado`, new Date().toISOString()]]);
      console.log(`Migração Blob → Redis (${prefixo()}): ${copiados} documento(s) copiado(s), ${falhas} falha(s).`);
      return !falhas;
    })().catch((e) => {
      migracao = null;
      throw e;
    });
  }
  return migracao;
}

async function lerRedis(pathname) {
  const completa = await garantirMigracao().catch(() => false);
  const [raw, ver] = await redis([["GET", kDoc(pathname)], ["GET", kVer(pathname)]]);
  if (raw != null) return { data: JSON.parse(raw), ver: ver || "0" };
  // Ainda não copiado (a cópia inicial teve falha): busca na Blob agora.
  if (!completa) {
    const data = await copiarDaBlob(pathname);
    if (data != null) return { data, ver: "1" };
  }
  return { data: null, ver: ver || "0" };
}

const CAS = `local cur = redis.call('GET', KEYS[2]) or '0'
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(tonumber(cur) + 1))
return 1`;

async function atualizarRedis(pathname, fn, tentativas = 8) {
  for (let i = 0; i < tentativas; i++) {
    const { data, ver } = await lerRedis(pathname);
    const novo = fn(data);
    const [ok] = await redis([["EVAL", CAS, "2", kDoc(pathname), kVer(pathname), String(ver), paraGuardar(novo)]]);
    if (Number(ok) === 1) return novo;
    await espera(40 + Math.random() * 120 * (i + 1));
  }
  throw new Error(`Não foi possível gravar ${pathname}: muitas gravações ao mesmo tempo. Tente de novo.`);
}

async function listarRedis(prefix) {
  await garantirMigracao().catch(() => false);
  const base = kDoc("");
  const out = [];
  let cursor = "0";
  do {
    const [[next, keys]] = await redis([["SCAN", cursor, "MATCH", `${base}${prefix}*`, "COUNT", "500"]]);
    cursor = String(next);
    for (const k of keys || []) out.push({ pathname: k.slice(base.length) });
  } while (cursor !== "0");
  return out;
}

/** Lê o documento (ou null se ainda não existir). */
export async function lerDoc(pathname) {
  if (usaRedis()) return (await lerRedis(pathname)).data;
  return lerDocBlob(pathname);
}

/**
 * Altera o documento com segurança contra gravações simultâneas.
 * `fn(atual)` recebe o documento atual (ou null) e devolve o novo.
 */
export async function atualizarDoc(pathname, fn, tentativas) {
  if (usaRedis()) return atualizarRedis(pathname, fn, tentativas);
  return atualizarDocBlob(pathname, fn, tentativas);
}

/** Grava o documento inteiro sem conferir a versão (o último a gravar vence). */
export async function gravarDocDireto(pathname, data) {
  if (!usaRedis()) return gravarDocDiretoBlob(pathname, data);
  await garantirMigracao().catch(() => false);
  await redis([["SET", kDoc(pathname), paraGuardar(data)], ["INCR", kVer(pathname)]]);
}

/** Lista os documentos de uma "pasta". */
export async function listarDocs(prefix) {
  if (usaRedis()) return listarRedis(prefix);
  return listarDocsBlob(prefix);
}

/** Apaga documentos. JSON sai do Redis; arquivos (fotos) saem da Blob. */
export async function apagarDocs(pathnames) {
  if (!pathnames.length) return;
  if (!usaRedis()) return apagarDocsBlob(pathnames);
  const docs = pathnames.filter((p) => p.endsWith(".json"));
  const arquivos = pathnames.filter((p) => !p.endsWith(".json"));
  if (docs.length) await redis([["DEL", ...docs.flatMap((p) => [kDoc(p), kVer(p)])]]);
  if (arquivos.length) await apagarDocsBlob(arquivos);
}

/** Situação do armazenamento (para conferência, sem segredos). */
export async function situacaoArmazenamento() {
  if (!usaRedis()) return { documentos: "blob", fotos: "blob" };
  const [migrado] = await redis([["GET", `${prefixo()}migrado`]]);
  return { documentos: "redis", fotos: "blob", prefixo: prefixo(), migrado: migrado || null };
}

/** Grava um arquivo binário (ex.: foto do álbum). Nome único por arquivo, então não precisa de versão. */
export async function gravarArquivo(pathname, buffer, contentType) {
  const { put } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      await put(pathname, buffer, { access, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
      blobAccess = access;
      return;
    } catch (e) {
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

/** Lê um arquivo binário: { stream, contentType } ou null. */
export async function lerArquivo(pathname) {
  const { get } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      const r = await get(pathname, { access });
      blobAccess = access;
      if (!r || !r.stream) return null;
      return { stream: r.stream, contentType: r.blob?.contentType || "application/octet-stream" };
    } catch (e) {
      if (naoExiste(e)) return null;
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

// Usado nos testes
export const _colecao = {
  setSdk: (m) => { blobSdk = m; blobAccess = null; versoes.clear(); },
  setRedisFetch: (f) => { redisFetch = f; migracao = null; },
  documentosConhecidos,
};
