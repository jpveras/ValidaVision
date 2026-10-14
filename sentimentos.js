// ======================================================
// SENTIMENTO DA SEMANA
// Cada pessoa da equipe conta, em uma frase curta (até 100 caracteres), como foi a semana.
// A nuvem é montada com as palavras mais citadas nas respostas; a IA lê as frases completas.
// A equipe vê a nuvem da semana atual; a gestora tem um painel com senha
// (SENTIMENTO_GESTORA_KEY) com histórico, ranking e remoção.
//
// Cada navegador pode enviar até SENTIMENTO_MAX_ENVIOS palavras por semana (padrão 3).
//
// ANÔNIMO: nenhum nome, IP ou identificador é gravado. Cada resposta guarda
// só a palavra, a semana e a data/hora.
//
// Armazenamento: Vercel Blob em sentimentos/<semana>.json (um arquivo por semana) quando
// BLOB_READ_WRITE_TOKEN existe; senão data/sentimentos.json (npm start) ou
// /tmp na Vercel sem Blob.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { gerarJSON, iaConfig, IAErro } from "./ia.js";
import { contarTermos } from "./palavras.js";
import { lerDoc, atualizarDoc, gravarDocDireto, apagarDocs, listarDocs, _colecao } from "./colecao.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "sentimentos/";
const TEXTO_MAX = 100;
const TZ = "America/Sao_Paulo";

function env() {
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(readFileSync(path.join(__dirname, ".env")));
  } catch {
    /* sem .env */
  }
  return { ...process.env, ...fileEnv };
}

const conf = () => {
  const e = env();
  return {
    equipe: Math.max(1, Number.parseInt(e.SENTIMENTO_EQUIPE || "15", 10) || 15),
    gestoraKey: String(e.SENTIMENTO_GESTORA_KEY || "").trim(),
    // Quantas palavras cada pessoa pode enviar por semana (controle feito no navegador).
    maxEnvios: Math.min(10, Math.max(1, Number.parseInt(e.SENTIMENTO_MAX_ENVIOS || "3", 10) || 3)),
  };
};

// ---------------- Semana (ISO, no fuso de São Paulo) ----------------

function dataEmSP(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}

// "2026-W41"
export function semanaDe(d = new Date()) {
  const dt = dataEmSP(d);
  const dia = dt.getUTCDay() || 7; // segunda=1 … domingo=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dia); // quinta-feira da semana ISO
  const ano = dt.getUTCFullYear();
  const inicioAno = new Date(Date.UTC(ano, 0, 1));
  const num = Math.ceil(((dt - inicioAno) / 86400000 + 1) / 7);
  return `${ano}-W${String(num).padStart(2, "0")}`;
}

const SEMANA_RE = /^\d{4}-W\d{2}$/;

// "Semana 41 · 06/10 a 12/10/2026"
export function rotuloSemana(semana) {
  const [ano, w] = semana.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(ano, 0, 4));
  const seg = new Date(jan4);
  seg.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  const dom = new Date(seg);
  dom.setUTCDate(seg.getUTCDate() + 6);
  const f = (d, comAno) =>
    `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}${comAno ? "/" + d.getUTCFullYear() : ""}`;
  return `Semana ${w} · ${f(seg, seg.getUTCFullYear() !== dom.getUTCFullYear())} a ${f(dom, true)}`;
}

// ---------------- Armazenamento ----------------

const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "sentimentos.json");

const fileStore = {
  kind: () => (process.env.VERCEL ? "temporario" : "arquivo-local"),
  async todos() {
    try {
      return JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      return [];
    }
  },
  async salvar(lista) {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(lista, null, 2));
  },
  async semanas() {
    const c = {};
    for (const r of await this.todos()) c[r.semana] = (c[r.semana] || 0) + 1;
    return c;
  },
  async daSemana(semana) {
    return (await this.todos()).filter((r) => r.semana === semana);
  },
  async adicionar(item) {
    const l = await this.todos();
    l.push(item);
    await this.salvar(l);
  },
  async remover(semana, id) {
    await this.salvar((await this.todos()).filter((r) => !(r.semana === semana && r.id === id)));
  },
};

// Vercel Blob: um arquivo JSON por semana (sentimentos/<semana>.json), ver colecao.js.
// Leitura = 1 operação simples; escrita segura contra envios simultâneos.
const docSemana = (semana) => `${PREFIX}${semana}.json`;

const blobStore = {
  kind: () => "vercel-blob",
  // Só o painel da gestora usa (lista os arquivos uma vez ao abrir).
  async semanas() {
    const c = {};
    const docs = (await listarDocs(PREFIX))
      .map((b) => b.pathname.slice(PREFIX.length).replace(/\.json$/, ""))
      .filter((s) => SEMANA_RE.test(s));
    await Promise.all(docs.map(async (s) => (c[s] = (await this.daSemana(s)).length)));
    return c;
  },
  async daSemana(semana) {
    return (await lerDoc(docSemana(semana)))?.itens || [];
  },
  async adicionar(item) {
    return (await atualizarDoc(docSemana(item.semana), (cur) => ({ itens: [...(cur?.itens || []), item] }))).itens;
  },
  async remover(semana, id) {
    return (await atualizarDoc(docSemana(semana), (cur) => ({ itens: (cur?.itens || []).filter((r) => r.id !== id) }))).itens;
  },
};

const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

// Cache por semana: várias pessoas com a tela aberta não geram uma consulta cada.
// Depois de gravar, o cache já recebe a lista nova.
const CACHE_TTL = 15000;
const cache = new Map();
async function respostasDa(semana, force = false) {
  const c = cache.get(semana);
  if (!force && c && Date.now() - c.at < CACHE_TTL) return c.data;
  const data = await store().daSemana(semana);
  cache.set(semana, { at: Date.now(), data });
  return data;
}
async function aposGravar(semana, itens) {
  if (Array.isArray(itens)) cache.set(semana, { at: Date.now(), data: itens });
  else await respostasDa(semana, true);
}

// ---------------- Palavras ----------------

// Respostas antigas guardavam só uma palavra (campo "palavra"); as novas, uma frase ("texto").
export const textoDe = (r) => String(r?.texto ?? r?.palavra ?? "");

// "semana" aparece em quase toda resposta ("semana puxada") e não diz nada sobre o clima.
const IGNORAR = new Set(["semana", "semanas"]);
// Comuns em outros textos, mas que no Sentimento dizem muito sobre a semana.
const MANTER = new Set(["bem", "mal", "melhor", "pior", "boa", "bom", "ruim", "ótima", "ótimo", "tranquila", "tranquilo"]);
function contar(respostas) {
  return contarTermos(respostas.map(textoDe), { limite: 100, ignorar: () => IGNORAR, manter: MANTER, inteiraSeVazia: true });
}

// Uma frase curta: até TEXTO_MAX caracteres, com pelo menos uma letra.
function validaTexto(raw) {
  const t = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return { erro: "Escreva como foi a sua semana." };
  if (t.length > TEXTO_MAX) return { erro: `Use no máximo ${TEXTO_MAX} caracteres.` };
  if (!/\p{L}/u.test(t)) return { erro: "Escreva com palavras, por favor." };
  if (/https?:\/\/|www\./i.test(t)) return { erro: "Não use links na resposta." };
  return { texto: t };
}

// ---------------- Senha da gestora ----------------

const tentativas = new Map();
function exigeGestora(req, res) {
  const { gestoraKey } = conf();
  if (!gestoraKey) {
    res.status(403).json({ error: "Defina SENTIMENTO_GESTORA_KEY (no .env ou na Vercel) para liberar o painel da gestora." });
    return false;
  }
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const t = tentativas.get(ip);
  if (t && Date.now() - t.desde > 10 * 60 * 1000) tentativas.delete(ip);
  if ((tentativas.get(ip)?.n || 0) >= 8) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    return false;
  }
  const enviada = String(req.get("x-gestora-key") || "");
  const ok = enviada.length === gestoraKey.length && crypto.timingSafeEqual(Buffer.from(enviada), Buffer.from(gestoraKey));
  if (!ok) {
    const cur = tentativas.get(ip) || { n: 0, desde: Date.now() };
    cur.n++;
    tentativas.set(ip, cur);
    res.status(401).json({ error: "Senha da gestora incorreta." });
    return false;
  }
  tentativas.delete(ip);
  return true;
}

// ---------------- Rotas ----------------

export const sentimentosRouter = express.Router();
sentimentosRouter.use(express.json({ limit: "2kb" }));
sentimentosRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const resumo = (semana, respostas) => {
  const palavras = contar(respostas);
  return {
    semana,
    rotulo: rotuloSemana(semana),
    equipe: conf().equipe,
    maxEnvios: conf().maxEnvios,
    total: respostas.length,
    palavraDaSemana: palavras[0]?.[0] || null,
    palavras,
  };
};

// Semana atual (equipe vê a nuvem completa, sem nada que identifique as pessoas).
sentimentosRouter.get("/", async (_req, res) => {
  try {
    const semana = semanaDe();
    res.json({ ...resumo(semana, await respostasDa(semana)), armazenamento: store().kind() });
  } catch (e) {
    console.error("Erro ao ler sentimentos:", e);
    res.status(500).json({ error: "Não consegui carregar o sentimento da semana agora." });
  }
});

const hashChave = (c) => crypto.createHash("sha256").update(String(c)).digest("hex");
const mesmaChave = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Quais das palavras enviadas por este navegador (ids) ainda existem na semana atual.
// Usado para liberar o campo de novo quando a gestora remove palavras. Só confirma ids que o
// próprio navegador já conhece; não expõe nada das outras respostas.
sentimentosRouter.get("/minhas", async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^[a-z0-9-]{4,40}$/i.test(x))
      .slice(0, 20);
    const semana = semanaDe();
    const existentes = new Set((await respostasDa(semana)).map((r) => r.id));
    res.json({ semana, existem: ids.filter((id) => existentes.has(id)) });
  } catch (e) {
    console.error("Erro ao conferir palavras:", e);
    res.status(500).json({ error: "Não consegui conferir agora." });
  }
});

// A própria pessoa apaga uma palavra que enviou nesta semana (precisa da chave recebida no envio).
const tentativasApagar = new Map();
sentimentosRouter.delete("/minha/:id", async (req, res) => {
  try {
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const janela = (tentativasApagar.get(ip) || []).filter((t) => agora - t < 60_000);
    if (janela.length >= 30) return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns segundos." });
    janela.push(agora);
    tentativasApagar.set(ip, janela);
    if (tentativasApagar.size > 5000) tentativasApagar.clear();

    const chave = String(req.get("x-sentimento-chave") || "");
    const id = String(req.params.id || "");
    if (!chave || !id) return res.status(400).json({ error: "Pedido incompleto." });
    const semana = semanaDe();
    const item = (await respostasDa(semana, true)).find((r) => r.id === id);
    if (!item) return res.status(404).json({ error: "Essa resposta já não está na semana atual." });
    if (!item.chave || !mesmaChave(item.chave, hashChave(chave))) {
      return res.status(403).json({ error: "Só quem enviou a resposta pode apagá-la." });
    }
    await aposGravar(semana, await store().remover(semana, id));
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao apagar a própria palavra:", e);
    res.status(500).json({ error: "Não consegui apagar a resposta agora. Tente de novo." });
  }
});

const ultimoEnvio = new Map(); // só em memória, para frear cliques repetidos; nunca é gravado
sentimentosRouter.post("/", async (req, res) => {
  try {
    const v = validaTexto(req.body?.texto ?? req.body?.palavra);
    if (v.erro) return res.status(400).json({ error: v.erro });
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    // Toda a equipe pode sair pelo mesmo IP da empresa: limite por minuto, folgado.
    const agora = Date.now();
    const janela = (ultimoEnvio.get(ip) || []).filter((t) => agora - t < 60_000);
    if (janela.length >= 40) {
      return res.status(429).json({ error: "Muitos envios em sequência. Aguarde alguns segundos e tente de novo." });
    }
    janela.push(agora);
    ultimoEnvio.set(ip, janela);
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const semana = semanaDe();
    // Chave aleatória para a própria pessoa poder apagar a palavra depois. Ela fica só no
    // navegador de quem enviou; aqui guardamos apenas o hash (não identifica ninguém).
    const chave = crypto.randomBytes(18).toString("base64url");
    const item = {
      id: crypto.randomUUID().slice(0, 8),
      semana,
      texto: v.texto,
      criadoEm: new Date().toISOString(),
      chave: hashChave(chave),
    };
    await aposGravar(semana, await store().adicionar(item));
    res.status(201).json({ ok: true, semana, rotulo: rotuloSemana(semana), id: item.id, chave });
  } catch (e) {
    console.error("Erro ao salvar sentimento:", e);
    res.status(500).json({ error: "Não consegui registrar sua resposta. Tente de novo." });
  }
});

// ---- Painel da gestora ----
sentimentosRouter.get("/gestora", (req, res) => {
  if (!exigeGestora(req, res)) return;
  res.json({ ok: true });
});

sentimentosRouter.get("/gestora/semanas", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  try {
    const atual = semanaDe();
    const c = await store().semanas();
    if (!(atual in c)) c[atual] = 0;
    res.json({
      atual,
      equipe: conf().equipe,
      semanas: Object.entries(c)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([semana, total]) => ({ semana, rotulo: rotuloSemana(semana), total })),
    });
  } catch (e) {
    console.error("Erro ao listar semanas:", e);
    res.status(500).json({ error: "Não consegui listar as semanas." });
  }
});

sentimentosRouter.get("/gestora/semana/:semana", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  const semana = String(req.params.semana);
  if (!SEMANA_RE.test(semana)) return res.status(400).json({ error: "Semana inválida." });
  try {
    const respostas = await respostasDa(semana, true);
    res.json({
      ...resumo(semana, respostas),
      respostas: respostas
        .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
        .map((r) => ({ id: r.id, texto: textoDe(r), criadoEm: r.criadoEm })),
    });
  } catch (e) {
    console.error("Erro ao ler semana:", e);
    res.status(500).json({ error: "Não consegui carregar essa semana." });
  }
});

// A gestora apaga a análise salva de uma semana (ex.: depois de remover as palavras).
// Precisa vir ANTES da rota de remover palavra (/:semana/:id), senão "analise" vira um id.
sentimentosRouter.delete("/gestora/semana/:semana/analise", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  const semana = String(req.params.semana);
  if (!SEMANA_RE.test(semana)) return res.status(400).json({ error: "Semana inválida." });
  try {
    await apagarAnalise(semana);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao apagar análise:", e);
    res.status(500).json({ error: "Não consegui apagar a análise agora." });
  }
});

sentimentosRouter.delete("/gestora/semana/:semana/:id", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  const semana = String(req.params.semana);
  if (!SEMANA_RE.test(semana)) return res.status(400).json({ error: "Semana inválida." });
  try {
    await aposGravar(semana, await store().remover(semana, String(req.params.id)));
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao remover sentimento:", e);
    res.status(500).json({ error: "Não consegui remover a resposta." });
  }
});


// ======================================================
// ANÁLISE DA SEMANA (IA) — só para a gestora
// A IA recebe apenas as palavras agregadas (nunca nomes, que nem existem).
// A análise fica salva por semana para não gastar outra chamada ao reabrir.
// ======================================================

const ANALISE_PREFIX = "analises-sentimento/";
const MIN_RESPOSTAS_ANALISE = 3;
const analiseCache = new Map();
const analiseLocalFile = () =>
  path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "analises-sentimento.json");

// Cache curto: o servidor roda em várias instâncias, e uma análise apagada ou refeita
// em uma delas precisa sumir/aparecer nas outras.
const ANALISE_TTL = 20_000;
async function lerAnalise(semana, force = false) {
  const c = analiseCache.get(semana);
  if (!force && c && Date.now() - c.at < ANALISE_TTL) return c.a;
  let a = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      a = await lerDoc(`${ANALISE_PREFIX}${semana}.json`);
    } catch (e) {
      console.error("Análise ilegível:", semana, e?.message);
    }
  } else {
    try {
      a = JSON.parse(await fs.readFile(analiseLocalFile(), "utf8"))[semana] || null;
    } catch {
      a = null;
    }
  }
  analiseCache.set(semana, { a, at: Date.now() });
  return a;
}

async function salvarAnalise(semana, registro) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // A análise é um documento único por semana, substituído por inteiro: grava direto.
    await gravarDocDireto(`${ANALISE_PREFIX}${semana}.json`, registro);
  } else {
    let todas = {};
    try {
      todas = JSON.parse(await fs.readFile(analiseLocalFile(), "utf8"));
    } catch {
      /* primeiro registro */
    }
    todas[semana] = registro;
    await fs.mkdir(path.dirname(analiseLocalFile()), { recursive: true });
    await fs.writeFile(analiseLocalFile(), JSON.stringify(todas, null, 2));
  }
  analiseCache.set(semana, { a: registro, at: Date.now() });
}

async function apagarAnalise(semana) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Exclui o arquivo da análise de vez (ler devolve "sem análise").
    await apagarDocs([`${ANALISE_PREFIX}${semana}.json`]);
  } else {
    let todas = {};
    try {
      todas = JSON.parse(await fs.readFile(analiseLocalFile(), "utf8"));
    } catch {
      /* nada salvo */
    }
    delete todas[semana];
    await fs.mkdir(path.dirname(analiseLocalFile()), { recursive: true });
    await fs.writeFile(analiseLocalFile(), JSON.stringify(todas, null, 2));
  }
  analiseCache.set(semana, { a: null, at: Date.now() });
}

const ANALISE_SYSTEM = `
Você apoia uma gestora de equipe a cuidar do clima do time. Toda sexta-feira, cada pessoa
da equipe escreve, de forma ANÔNIMA, uma frase curta (até 100 caracteres) sobre como foi a
própria semana. Você recebe essas respostas (sem autor e em ordem aleatória), as palavras
mais citadas, a quantidade de respostas e, quando houver, as respostas da semana anterior.

Sua tarefa: entender o CONTEXTO das respostas (o que pesou, o que foi bom, causas citadas)
e sugerir ações práticas para a gestora trabalhar com a equipe.

REGRAS:
- Baseie-se SOMENTE nas respostas recebidas. Não invente fatos, causas ou contexto que não
  estejam escritos; quando algo for hipótese, diga "pode indicar".
- Leia o sentido de cada frase (ex.: "cansativa, mas consegui entregar" é cansaço com entrega),
  inclusive negação e ironia. Agrupe respostas parecidas em temas.
- As respostas são anônimas: as ações devem ser COLETIVAS (reunião, dinâmica, ajuste de
  demanda, reconhecimento, rituais). Nunca sugira descobrir quem escreveu cada resposta.
- Se uma resposta citar nomes de pessoas, NÃO repita os nomes na análise; fale do tema.
- Não copie frases inteiras das respostas; resuma com suas palavras (no máximo trechos curtos).
- Cada pessoa pode enviar mais de uma resposta por semana, então o total de respostas NÃO é o
  número de pessoas. Poucas respostas (menos respostas do que pessoas na equipe) também é um
  sinal: comente quando ocorrer.
- Se houver semana anterior, compare o tom e diga se melhorou, piorou ou se manteve.
- Você NÃO faz diagnóstico de saúde mental. Se aparecerem sinais de esgotamento, tristeza
  forte ou desmotivação (ex.: esgotado, exausto, desmotivado, sobrecarregado, ansioso),
  preencha "apoio" recomendando, com delicadeza, envolver o RH ou programas de bem-estar
  da empresa. Caso contrário, deixe "apoio" como string vazia.
- Clima: "positivo" (predomínio de respostas boas), "neutro" (equilíbrio), "atencao"
  (predomínio de desgaste/pressão) ou "alerta" (sinais fortes de esgotamento ou piora
  importante).
- Gere de 3 a 5 sugestões, da mais importante para a menos. Cada uma com título curto,
  "porque" (ligado ao que foi escrito), "como" (passos concretos e simples) e "quando"
  (ex.: "esta semana", "na próxima reunião", "nas próximas semanas").
- "perguntaAbertura": uma pergunta aberta e acolhedora para a gestora usar com a equipe.
- "evitar": 1 a 3 cuidados (ex.: não tentar identificar autores; não minimizar o cansaço).
- Português do Brasil, tom acolhedor, direto e profissional. Frases curtas.
- Responda SOMENTE com o JSON solicitado.
`;

const ANALISE_SCHEMA = {
  type: "OBJECT",
  properties: {
    clima: { type: "STRING", enum: ["positivo", "neutro", "atencao", "alerta"] },
    leitura: { type: "STRING" },
    temas: { type: "ARRAY", items: { type: "STRING" } },
    tendencia: { type: "STRING" },
    sugestoes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          titulo: { type: "STRING" },
          porque: { type: "STRING" },
          como: { type: "STRING" },
          quando: { type: "STRING" },
        },
        required: ["titulo", "porque", "como", "quando"],
      },
    },
    perguntaAbertura: { type: "STRING" },
    evitar: { type: "ARRAY", items: { type: "STRING" } },
    apoio: { type: "STRING" },
  },
  required: ["clima", "leitura", "temas", "tendencia", "sugestoes", "perguntaAbertura", "evitar", "apoio"],
};

const ANALISE_DEMO = {
  clima: "atencao",
  leitura: "Modo demonstração (a IA não foi chamada): exemplo de leitura com predomínio de palavras de cansaço e ritmo intenso, mas com sinais de entrega.",
  temas: ["Ritmo intenso", "Cansaço", "Sensação de entrega"],
  tendencia: "Sem semana anterior para comparar.",
  sugestoes: [
    { titulo: "Conversa rápida de alinhamento", porque: "Exemplo de demonstração.", como: "Reúna a equipe por 15 minutos e ouça o que mais pesou.", quando: "esta semana" },
    { titulo: "Revisar prioridades", porque: "Exemplo de demonstração.", como: "Liste as demandas e combine o que pode esperar.", quando: "na próxima reunião" },
    { titulo: "Reconhecer o esforço", porque: "Exemplo de demonstração.", como: "Agradeça publicamente as entregas da semana.", quando: "esta semana" },
  ],
  perguntaAbertura: "O que mais pesou nesta semana e o que podemos ajustar juntos?",
  evitar: ["Tentar descobrir quem escreveu cada resposta."],
  apoio: "",
};

// Embaralha para a ordem não sugerir quem respondeu primeiro.
const embaralha = (l) => {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function textoParaIA(semana, atual, anterior, equipe, maxEnvios = conf().maxEnvios) {
  const linhas = [
    `Semana: ${rotuloSemana(semana)}`,
    `Respostas: ${atual.length} (equipe de ${equipe} pessoas; cada pessoa pode enviar até ${maxEnvios})`,
    "",
    "Respostas desta semana (anônimas, ordem aleatória):",
    ...embaralha(atual.map(textoDe)).map((t) => `- "${t}"`),
    "",
    "Palavras mais citadas (palavra: vezes):",
    ...contar(atual).slice(0, 25).map(([p, n]) => `- ${p}: ${n}`),
  ];
  if (anterior?.respostas?.length) {
    linhas.push("", `Semana anterior (${rotuloSemana(anterior.semana)}), ${anterior.respostas.length} respostas:`);
    linhas.push(...embaralha(anterior.respostas.map(textoDe)).map((t) => `- "${t}"`));
  } else {
    linhas.push("", "Não há semana anterior com respostas para comparar.");
  }
  return linhas.join("\n");
}

async function semanaAnteriorCom(semana) {
  const todas = Object.keys(await store().semanas())
    .filter((s) => s < semana)
    .sort();
  const ant = todas.at(-1);
  return ant ? { semana: ant, respostas: await respostasDa(ant) } : null;
}

sentimentosRouter.get("/gestora/semana/:semana/analise", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  const semana = String(req.params.semana);
  if (!SEMANA_RE.test(semana)) return res.status(400).json({ error: "Semana inválida." });
  try {
    res.json({ analise: await lerAnalise(semana, true), minimo: MIN_RESPOSTAS_ANALISE });
  } catch (e) {
    console.error("Erro ao ler análise:", e);
    res.status(500).json({ error: "Não consegui carregar a análise." });
  }
});

sentimentosRouter.post("/gestora/semana/:semana/analise", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  const semana = String(req.params.semana);
  if (!SEMANA_RE.test(semana)) return res.status(400).json({ error: "Semana inválida." });
  try {
    const atual = await respostasDa(semana, true);
    if (atual.length < MIN_RESPOSTAS_ANALISE) {
      return res.status(400).json({
        error: `São necessárias pelo menos ${MIN_RESPOSTAS_ANALISE} respostas para gerar a análise (esta semana tem ${atual.length}).`,
      });
    }
    const { equipe, maxEnvios } = conf();
    let analise, modelo, provedor = "demo";
    if (iaConfig().demoMode) {
      analise = ANALISE_DEMO;
      modelo = "demo";
    } else {
      const anterior = await semanaAnteriorCom(semana);
      ({ data: analise, model: modelo, provider: provedor } = await gerarJSON({
        system: ANALISE_SYSTEM,
        texto: textoParaIA(semana, atual, anterior, equipe, maxEnvios),
        schema: ANALISE_SCHEMA,
      }));
    }
    const registro = {
      semana,
      geradaEm: new Date().toISOString(),
      modelo,
      provedor,
      totalNaGeracao: atual.length,
      analise: {
        ...analise,
        clima: ["positivo", "neutro", "atencao", "alerta"].includes(analise.clima) ? analise.clima : "neutro",
        leitura: String(analise.leitura || ""),
        tendencia: String(analise.tendencia || ""),
        perguntaAbertura: String(analise.perguntaAbertura || ""),
        apoio: String(analise.apoio || ""),
        temas: (Array.isArray(analise.temas) ? analise.temas : []).map(String).slice(0, 6),
        sugestoes: (Array.isArray(analise.sugestoes) ? analise.sugestoes : []).filter((x) => x && x.titulo).slice(0, 5),
        evitar: (Array.isArray(analise.evitar) ? analise.evitar : []).map(String).slice(0, 3),
      },
    };
    await salvarAnalise(semana, registro);
    res.json({ analise: registro });
  } catch (e) {
    console.error("Erro ao gerar análise:", e);
    res.status(e instanceof IAErro ? e.status : 500).json({
      error: e instanceof IAErro ? e.message : "Não consegui gerar a análise agora. Tente de novo.",
    });
  }
});

// Usado nos testes
export const _interno = { semanaDe, rotuloSemana, validaTexto, contar, blobStore, setSdk: (m) => { _colecao.setSdk(m); cache.clear(); analiseCache.clear(); }, textoParaIA };
