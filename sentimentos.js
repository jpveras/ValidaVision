// ======================================================
// SENTIMENTO DA SEMANA
// Cada pessoa da equipe informa uma palavra que define a sua semana.
// A equipe vê a nuvem da semana atual; a gestora tem um painel com senha
// (SENTIMENTO_GESTORA_KEY) com histórico, ranking e remoção.
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
import { lerDoc, atualizarDoc, listarDocs, _colecao } from "./colecao.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "sentimentos/";
const PALAVRA_MAX = 30;
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

const normaliza = (p) => p.toLocaleLowerCase("pt-BR").trim();

function contar(respostas) {
  const c = new Map();
  for (const r of respostas) c.set(normaliza(r.palavra), (c.get(normaliza(r.palavra)) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
}

// Aceita uma palavra (ou expressão curta de até 2 palavras, ex.: "bem puxada"), só letras.
function validaPalavra(raw) {
  const p = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!p) return { erro: "Escreva uma palavra." };
  if (p.length > PALAVRA_MAX) return { erro: `Use no máximo ${PALAVRA_MAX} caracteres.` };
  if (p.split(" ").length > 2) return { erro: "Use só uma palavra (ou duas, no máximo)." };
  if (!/^[\p{L}]+(?:[-'\s][\p{L}]+)*$/u.test(p)) return { erro: "Use apenas letras, sem números ou símbolos." };
  return { palavra: p };
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

const ultimoEnvio = new Map(); // só em memória, para frear cliques repetidos; nunca é gravado
sentimentosRouter.post("/", async (req, res) => {
  try {
    const v = validaPalavra(req.body?.palavra);
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
    const item = { id: crypto.randomUUID().slice(0, 8), semana, palavra: v.palavra, criadoEm: new Date().toISOString() };
    await aposGravar(semana, await store().adicionar(item));
    res.status(201).json({ ok: true, semana, rotulo: rotuloSemana(semana) });
  } catch (e) {
    console.error("Erro ao salvar sentimento:", e);
    res.status(500).json({ error: "Não consegui registrar sua palavra. Tente de novo." });
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
        .map(({ id, palavra, criadoEm }) => ({ id, palavra, criadoEm })),
    });
  } catch (e) {
    console.error("Erro ao ler semana:", e);
    res.status(500).json({ error: "Não consegui carregar essa semana." });
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
    res.status(500).json({ error: "Não consegui remover a palavra." });
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

async function lerAnalise(semana) {
  if (analiseCache.has(semana)) return analiseCache.get(semana);
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
  analiseCache.set(semana, a);
  return a;
}

async function salvarAnalise(semana, registro) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await atualizarDoc(`${ANALISE_PREFIX}${semana}.json`, () => registro);
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
  analiseCache.set(semana, registro);
}

const ANALISE_SYSTEM = `
Você apoia uma gestora de equipe a cuidar do clima do time. Toda sexta-feira, cada pessoa
da equipe escreve, de forma ANÔNIMA, uma palavra que define a própria semana. Você recebe
apenas essas palavras agregadas (com quantas vezes cada uma apareceu), a participação e,
quando houver, as palavras da semana anterior.

Sua tarefa: fazer uma leitura cuidadosa e sugerir ações práticas para a gestora trabalhar
com a equipe.

REGRAS:
- Baseie-se SOMENTE nas palavras recebidas. Não invente fatos, causas ou contexto que não
  estejam evidentes; quando algo for hipótese, diga "pode indicar".
- As respostas são anônimas: as ações devem ser COLETIVAS (reunião, dinâmica, ajuste de
  demanda, reconhecimento, rituais). Nunca sugira descobrir quem escreveu cada palavra.
- Considere o peso de cada palavra (quantas vezes apareceu) e o equilíbrio entre palavras
  positivas, neutras e negativas.
- Participação baixa (menos da metade da equipe) também é um sinal: comente quando ocorrer.
- Se houver semana anterior, compare o tom e diga se melhorou, piorou ou se manteve.
- Você NÃO faz diagnóstico de saúde mental. Se aparecerem palavras de esgotamento, tristeza
  forte ou desmotivação (ex.: esgotado, exausto, desmotivado, sobrecarregado, ansioso),
  preencha "apoio" recomendando, com delicadeza, envolver o RH ou programas de bem-estar
  da empresa. Caso contrário, deixe "apoio" como string vazia.
- Clima: "positivo" (predomínio de palavras boas), "neutro" (equilíbrio), "atencao"
  (predomínio de desgaste/pressão) ou "alerta" (sinais fortes de esgotamento ou piora
  importante).
- Gere de 3 a 5 sugestões, da mais importante para a menos. Cada uma com título curto,
  "porque" (ligado às palavras), "como" (passos concretos e simples) e "quando"
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
  evitar: ["Tentar descobrir quem escreveu cada palavra."],
  apoio: "",
};

function textoParaIA(semana, atual, anterior, equipe) {
  const linhas = [
    `Semana: ${rotuloSemana(semana)}`,
    `Participação: ${atual.length} de ${equipe} pessoas (${Math.round((atual.length / equipe) * 100)}%)`,
    `Palavras desta semana (palavra: vezes):`,
    ...contar(atual).map(([p, n]) => `- ${p}: ${n}`),
  ];
  if (anterior?.respostas?.length) {
    linhas.push("", `Semana anterior (${rotuloSemana(anterior.semana)}), ${anterior.respostas.length} respostas:`);
    linhas.push(...contar(anterior.respostas).map(([p, n]) => `- ${p}: ${n}`));
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
    res.json({ analise: await lerAnalise(semana), minimo: MIN_RESPOSTAS_ANALISE });
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
    const { equipe } = conf();
    let analise, modelo;
    if (iaConfig().demoMode) {
      analise = ANALISE_DEMO;
      modelo = "demo";
    } else {
      const anterior = await semanaAnteriorCom(semana);
      ({ data: analise, model: modelo } = await gerarJSON({
        system: ANALISE_SYSTEM,
        texto: textoParaIA(semana, atual, anterior, equipe),
        schema: ANALISE_SCHEMA,
      }));
    }
    const registro = {
      semana,
      geradaEm: new Date().toISOString(),
      modelo,
      totalNaGeracao: atual.length,
      analise: {
        ...analise,
        sugestoes: (analise.sugestoes || []).slice(0, 5),
        evitar: (analise.evitar || []).slice(0, 3),
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
export const _interno = { semanaDe, rotuloSemana, validaPalavra, contar, blobStore, setSdk: (m) => { _colecao.setSdk(m); cache.clear(); analiseCache.clear(); }, textoParaIA };
