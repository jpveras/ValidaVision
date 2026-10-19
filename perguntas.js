// ======================================================
// PERGUNTA DA SEMANA
//
// A gestora (senha SENTIMENTO_GESTORA_KEY) lança uma pergunta curta para a equipe
// ("O que te ajudaria a ter mais foco?"). Cada pessoa responde anonimamente (até 200
// caracteres, até 3 respostas por navegador). As palavras mais citadas viram nuvem;
// a gestora lê as respostas e pode pedir um resumo à IA.
//
// Só uma pergunta fica aberta por vez; as anteriores ficam no histórico.
// ANÔNIMO: nada de nome ou IP. O navegador guarda id+chave para a pessoa apagar a própria resposta.
//
// Armazenamento: Vercel Blob em perguntas/_dados.json (um arquivo só) quando
// BLOB_READ_WRITE_TOKEN existe; senão data/perguntas.json (local) ou /tmp na Vercel.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, atualizarDoc, _colecao } from "./colecao.js";
import { contarTermos } from "./palavras.js";
import { exigeGestora } from "./sentimentos.js";
import { gerarJSON, iaConfig, IAErro } from "./ia.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "perguntas/_dados.json";
const PERGUNTA_MAX = 140;
const RESPOSTA_MAX = 200;
const MAX_POR_PESSOA = 3;
const MIN_RESUMO = 3;

const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "perguntas.json");

const fileStore = {
  kind: () => (process.env.VERCEL ? "temporario" : "arquivo-local"),
  async ler() {
    try {
      return JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      return { perguntas: [] };
    }
  },
  async alterar(fn) {
    const novo = fn(await this.ler());
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(novo, null, 2));
    return novo;
  },
};
const blobStore = {
  kind: () => "vercel-blob",
  async ler() {
    return (await lerDoc(DOC)) || { perguntas: [] };
  },
  async alterar(fn) {
    return atualizarDoc(DOC, (cur) => fn(cur || { perguntas: [] }));
  },
};
const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

const TTL = 10_000;
let cache = { at: 0, doc: null };
async function ler(force = false) {
  if (!force && cache.doc && Date.now() - cache.at < TTL) return cache.doc;
  const doc = await store().ler();
  doc.perguntas ||= [];
  cache = { at: Date.now(), doc };
  return doc;
}
async function alterar(fn) {
  const doc = await store().alterar((d) => fn({ perguntas: [], ...d }));
  cache = { at: Date.now(), doc };
  return doc;
}

const aberta = (doc) => doc.perguntas.find((p) => !p.encerradaEm) || null;
const hash = (c) => crypto.createHash("sha256").update(String(c ?? "")).digest("hex");
const mesma = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const limpa = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max + 1);
const contar = (respostas) => contarTermos(respostas.map((r) => r.texto), { limite: 80, inteiraSeVazia: true });
const dataBR = (iso) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

export const perguntasRouter = express.Router();
perguntasRouter.use(express.json({ limit: "4kb" }));
perguntasRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Pergunta aberta (a equipe vê a pergunta, quantas respostas e a nuvem — nunca as frases).
perguntasRouter.get("/", async (_req, res) => {
  try {
    const doc = await ler();
    const p = aberta(doc);
    res.json({
      maxPorPessoa: MAX_POR_PESSOA,
      armazenamento: store().kind(),
      pergunta: p ? { id: p.id, texto: p.texto, criadaEm: p.criadaEm, total: p.respostas.length, palavras: contar(p.respostas) } : null,
      anterior: (() => {
        const e = doc.perguntas.filter((x) => x.encerradaEm).sort((a, b) => b.encerradaEm.localeCompare(a.encerradaEm))[0];
        return e ? { texto: e.texto, total: e.respostas.length, encerradaEm: e.encerradaEm } : null;
      })(),
    });
  } catch (e) {
    console.error("Erro ao ler pergunta:", e);
    res.status(500).json({ error: "Não consegui carregar a pergunta agora." });
  }
});

// Quais das respostas deste navegador ainda existem (a gestora pode ter removido alguma).
perguntasRouter.post("/minhas", async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 10);
    const p = aberta(await ler(true));
    const existentes = new Set((p?.respostas || []).map((r) => r.id));
    res.json({ pergunta: p?.id || null, existem: ids.filter((id) => existentes.has(id)) });
  } catch (e) {
    res.status(500).json({ error: "Não consegui conferir agora." });
  }
});

const ultimoEnvio = new Map(); // só em memória; nunca é gravado
perguntasRouter.post("/", async (req, res) => {
  try {
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const janela = (ultimoEnvio.get(ip) || []).filter((t) => agora - t < 60_000);
    if (janela.length >= 20) return res.status(429).json({ error: "Muitas respostas seguidas. Aguarde um pouco." });
    janela.push(agora);
    ultimoEnvio.set(ip, janela);
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const texto = limpa(req.body?.texto, RESPOSTA_MAX);
    if (!texto) return res.status(400).json({ error: "Escreva a sua resposta." });
    if (texto.length > RESPOSTA_MAX) return res.status(400).json({ error: `Use no máximo ${RESPOSTA_MAX} caracteres.` });
    if (!/\p{L}/u.test(texto)) return res.status(400).json({ error: "Escreva com palavras, por favor." });
    if (/https?:\/\/|www\./i.test(texto)) return res.status(400).json({ error: "Não use links na resposta." });
    const perguntaId = String(req.body?.pergunta || "");

    const chave = crypto.randomBytes(16).toString("hex");
    const item = { id: crypto.randomUUID(), texto, criadoEm: new Date().toISOString(), chave: hash(chave) };
    let erro = null;
    await alterar((doc) => {
      const p = aberta(doc);
      if (!p) return (erro = "Não há pergunta aberta no momento."), doc;
      if (perguntaId && p.id !== perguntaId) return (erro = "A pergunta mudou. Recarregue a página."), doc;
      p.respostas.push(item);
      return doc;
    });
    if (erro) return res.status(409).json({ error: erro });
    res.json({ ok: true, id: item.id, chave });
  } catch (e) {
    console.error("Erro ao salvar resposta:", e);
    res.status(500).json({ error: "Não consegui enviar agora. Tente de novo." });
  }
});

perguntasRouter.delete("/minha/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const chave = hash(req.get("x-pergunta-chave") || "");
    let ok = false, achou = false;
    await alterar((doc) => {
      const p = aberta(doc);
      const r = p?.respostas.find((x) => x.id === id);
      if (!r) return doc;
      achou = true;
      if (!mesma(r.chave || "", chave)) return doc;
      ok = true;
      p.respostas = p.respostas.filter((x) => x.id !== id);
      return doc;
    });
    if (!achou) return res.status(404).json({ error: "Essa resposta já não existe." });
    if (!ok) return res.status(403).json({ error: "Só quem enviou pode apagar." });
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao apagar resposta:", e);
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

// ---------------- Gestora ----------------

const paraGestora = (p) => ({
  id: p.id,
  texto: p.texto,
  criadaEm: p.criadaEm,
  encerradaEm: p.encerradaEm || null,
  total: p.respostas.length,
  palavras: contar(p.respostas),
  respostas: p.respostas.map((r) => ({ id: r.id, texto: r.texto, criadoEm: r.criadoEm })),
  resumo: p.resumo || null,
});

perguntasRouter.get("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const doc = await ler(true);
    const ord = doc.perguntas.slice().sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
    res.json({ perguntas: ord.map(paraGestora), minimoResumo: MIN_RESUMO, maxPergunta: PERGUNTA_MAX });
  } catch (e) {
    console.error("Erro ao listar perguntas:", e);
    res.status(500).json({ error: "Não consegui carregar as perguntas." });
  }
});

// Nova pergunta: encerra a que estiver aberta.
perguntasRouter.post("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const texto = limpa(req.body?.texto, PERGUNTA_MAX);
    if (texto.length < 5) return res.status(400).json({ error: "Escreva a pergunta (pelo menos 5 caracteres)." });
    if (texto.length > PERGUNTA_MAX) return res.status(400).json({ error: `Use no máximo ${PERGUNTA_MAX} caracteres.` });
    const agora = new Date().toISOString();
    const nova = { id: crypto.randomUUID(), texto, criadaEm: agora, encerradaEm: null, respostas: [] };
    await alterar((doc) => {
      for (const p of doc.perguntas) if (!p.encerradaEm) p.encerradaEm = agora;
      doc.perguntas.push(nova);
      doc.perguntas = doc.perguntas.slice(-60);
      return doc;
    });
    res.json({ ok: true, pergunta: paraGestora(nova) });
  } catch (e) {
    console.error("Erro ao criar pergunta:", e);
    res.status(500).json({ error: "Não consegui criar a pergunta agora." });
  }
});

perguntasRouter.post("/gestora/:id/encerrar", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    await alterar((doc) => {
      const p = doc.perguntas.find((x) => x.id === id);
      if (p && !p.encerradaEm) p.encerradaEm = new Date().toISOString();
      return doc;
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui encerrar agora." });
  }
});

perguntasRouter.delete("/gestora/:id/resposta/:rid", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    await alterar((doc) => {
      const p = doc.perguntas.find((x) => x.id === String(req.params.id));
      if (p) p.respostas = p.respostas.filter((r) => r.id !== String(req.params.rid));
      return doc;
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui remover agora." });
  }
});

perguntasRouter.delete("/gestora/:id", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    await alterar((doc) => ((doc.perguntas = doc.perguntas.filter((x) => x.id !== String(req.params.id))), doc));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

// ---------------- Resumo com IA ----------------

const RESUMO_SYSTEM = `
Você ajuda uma coordenadora de uma equipe de QA a ler, com cuidado, as respostas ANÔNIMAS da equipe a uma pergunta aberta.
Regras:
- Responda em português do Brasil, em tom acolhedor e objetivo.
- Agrupe as ideias em temas; diga quantas respostas mais ou menos apoiam cada tema ("várias", "algumas", "uma").
- NUNCA tente identificar quem escreveu. Se alguma resposta citar nome de pessoa, não repita o nome.
- Não copie frases inteiras; parafraseie.
- Sugira até 3 próximos passos práticos para a coordenadora, coerentes com as respostas.
- Se as respostas forem poucas ou vagas, diga isso com honestidade.
`.trim();
const RESUMO_SCHEMA = {
  type: "OBJECT",
  properties: {
    resumo: { type: "STRING", description: "2 a 4 frases com a leitura geral." },
    temas: { type: "ARRAY", items: { type: "OBJECT", properties: { tema: { type: "STRING" }, apoio: { type: "STRING" } }, required: ["tema", "apoio"] } },
    proximosPassos: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["resumo", "temas", "proximosPassos"],
};
const embaralha = (l) => {
  const a = l.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

perguntasRouter.post("/gestora/:id/resumo", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const doc = await ler(true);
    const p = doc.perguntas.find((x) => x.id === String(req.params.id));
    if (!p) return res.status(404).json({ error: "Pergunta não encontrada." });
    if (p.respostas.length < MIN_RESUMO) return res.status(400).json({ error: `São necessárias pelo menos ${MIN_RESUMO} respostas para o resumo.` });
    let resumo, modelo = "demo", provedor = "demo";
    if (iaConfig().demoMode) {
      resumo = {
        resumo: "Modo demonstração (a IA não foi chamada): exemplo de leitura das respostas.",
        temas: [{ tema: "Exemplo de tema", apoio: "algumas respostas" }],
        proximosPassos: ["Exemplo de próximo passo."],
      };
    } else {
      const texto = [
        `Pergunta feita à equipe (${dataBR(p.criadaEm)}): "${p.texto}"`,
        `${p.respostas.length} respostas anônimas, em ordem aleatória:`,
        ...embaralha(p.respostas).map((r) => `- "${r.texto}"`),
      ].join("\n");
      ({ data: resumo, model: modelo, provider: provedor } = await gerarJSON({ system: RESUMO_SYSTEM, texto, schema: RESUMO_SCHEMA }));
    }
    const registro = {
      geradoEm: new Date().toISOString(),
      totalNaGeracao: p.respostas.length,
      modelo,
      provedor,
      resumo: String(resumo?.resumo || "").slice(0, 1200),
      temas: (Array.isArray(resumo?.temas) ? resumo.temas : []).slice(0, 6).map((t) => ({ tema: String(t?.tema || "").slice(0, 120), apoio: String(t?.apoio || "").slice(0, 60) })),
      proximosPassos: (Array.isArray(resumo?.proximosPassos) ? resumo.proximosPassos : []).slice(0, 3).map((x) => String(x).slice(0, 240)),
    };
    await alterar((d) => {
      const q = d.perguntas.find((x) => x.id === p.id);
      if (q) q.resumo = registro;
      return d;
    });
    res.json({ ok: true, resumo: registro });
  } catch (e) {
    console.error("Erro no resumo da pergunta:", e);
    res.status(e instanceof IAErro ? 503 : 500).json({ error: e instanceof IAErro ? e.message : "Não consegui gerar o resumo agora." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); cache = { at: 0, doc: null }; } };
