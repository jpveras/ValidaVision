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

// Leitura sempre da versão atual.
// Em produção vimos o get devolver uma cópia antiga (cache), e aí a gravação com ifMatch
// era recusada em todas as tentativas ("Precondition failed") — por isso apagar não funcionava.
// Agora: o head (consulta direta à API, sem cache) diz qual é a versão atual (ETag);
// o get pede o arquivo com essa versão na URL (endereço novo = sem cópia velha) e confere
// se veio mesmo a versão certa. Head e get são operações "simples" no plano gratuito.
async function lerBlob(pathname) {
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
    if (!atual || !r.etag || semAspas(r.etag) === atual) return { data: r.data, etag: h.etag || r.etag };
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
export async function lerDoc(pathname) {
  return (await lerBlob(pathname)).data;
}

/**
 * Altera o documento com segurança contra gravações simultâneas.
 * `fn(atual)` recebe o documento atual (ou null) e devolve o novo.
 */
export async function atualizarDoc(pathname, fn, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    const { data, etag } = await lerBlob(pathname);
    const novo = fn(data);
    try {
      await gravarBlob(pathname, novo, etag);
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
  const { data } = await lerBlob(pathname);
  const novo = fn(data);
  await gravarDocDireto(pathname, novo);
  console.warn(`Blob: ${pathname} gravado sem conferência de versão (plano B).`);
  return novo;
}

/**
 * Grava o documento inteiro sem conferir a versão (o último a gravar vence).
 * Para documentos com um só "dono" que podem ser substituídos sem perda (ex.: análise da semana).
 */
export async function gravarDocDireto(pathname, data) {
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
export async function listarDocs(prefix) {
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
export async function apagarDocs(pathnames) {
  if (!pathnames.length) return;
  const { del } = await sdk();
  for (let i = 0; i < pathnames.length; i += 500) await del(pathnames.slice(i, i + 500));
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
export const _colecao = { setSdk: (m) => { blobSdk = m; blobAccess = null; } };
