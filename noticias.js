// ======================================================
// TOCA NEWS: o resumo da semana da Toca
//
// Toda segunda de manhã (Vercel Cron, ver vercel.json) o servidor junta o que aconteceu na
// semana anterior — elogios, Sentimento da Semana, desafio, fotos do álbum — e o que vem por
// aí (aniversários, tempo de casa, agenda) e escreve uma edição curta do "Toca News".
// A IA escreve o texto; se ela falhar, sai uma versão montada por modelo fixo (nunca fica sem).
// Depois avisa por notificação quem ativou os lembretes.
//
// Privacidade: a edição só usa números e palavras soltas. Nenhuma frase do Sentimento, nenhum
// texto de elogio e nenhum nome de quem elogiou entra no resumo.
//
// A gestora (Área da Gestora → aba "Toca News") pode ver, editar, gerar de novo, esconder,
// apagar e mandar a notificação na hora.
//
// Armazenamento: Vercel Blob em noticias/_dados.json (últimas 12 edições); local data/noticias.json.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, gravarDocDireto } from "./colecao.js";
import { gerarJSON, iaConfig } from "./ia.js";
import { exigeGestora, semanaDe, rotuloSemana, resumoSentimento } from "./sentimentos.js";
import { resumoElogios } from "./elogios.js";
import { resumoDesafios } from "./desafios.js";
import { resumoAlbum } from "./album.js";
import { resumoPublico } from "./time.js";
import { enviarMensagem, cronAutorizado, diaSemanaSP } from "./lembretes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "noticias/_dados.json";
const MAX_EDICOES = 12;
const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "noticias.json");

// Muda uma vez por semana: memória longa; quem grava atualiza na hora.
const TTL = 10 * 60_000;
let cache = { at: 0, doc: null };
async function ler(force = false) {
  if (!force && cache.doc && Date.now() - cache.at < TTL) return cache.doc;
  let doc = null;
  if (usaBlob()) doc = await lerDoc(DOC);
  else {
    try {
      doc = JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      doc = null;
    }
  }
  doc = { edicoes: [], ...(doc || {}) };
  cache = { at: Date.now(), doc };
  return doc;
}
async function alterar(fn) {
  const doc = fn(structuredClone(await ler(true)));
  doc.edicoes = doc.edicoes.sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, MAX_EDICOES);
  if (usaBlob()) await gravarDocDireto(DOC, doc);
  else {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(doc, null, 2));
  }
  cache = { at: Date.now(), doc };
  return doc;
}

// ---------------- Semana ----------------
// Última semana completa (segunda a domingo) e a semana atual, no fuso de São Paulo.
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
function semanaPassada() {
  const h = hojeSP();
  const d = new Date(`${h}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7)); // domingo anterior
  return semanaDe(new Date(d.getTime() + 3 * 3600_000));
}
const semanaAtual = () => semanaDe();
// Início (segunda 00:00 em SP = 03:00 UTC) e fim (segunda seguinte) da semana ISO.
function intervalo(semana) {
  const [ano, w] = semana.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(ano, 0, 4));
  const seg = new Date(jan4);
  seg.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  seg.setUTCHours(3);
  const fim = new Date(seg.getTime() + 7 * 86400_000);
  return { desde: seg.toISOString(), ate: fim.toISOString() };
}
const SEMANA_RE = /^\d{4}-W\d{2}$/;

// ---------------- Dados da semana ----------------
async function seguro(fn, padrao) {
  try {
    return await fn();
  } catch (e) {
    console.error("Toca News: falha ao ler dados", e?.message || e);
    return padrao;
  }
}
export async function dadosDaSemana(semana) {
  const { desde, ate } = intervalo(semana);
  const [elogios, sentimento, desafios, album, agenda] = await Promise.all([
    seguro(() => resumoElogios(desde, ate), { total: 0, pessoas: 0, temas: [] }),
    seguro(() => resumoSentimento(semana), { total: 0, palavraDaSemana: null, palavras: [] }),
    seguro(() => resumoDesafios(desde, ate), { desafios: [], podio: [], rotuloMes: "" }),
    seguro(() => resumoAlbum(desde, ate), { fotos: 0, momentos: [], comentarios: 0 }),
    seguro(() => resumoPublico(10), { aniversarios: [], casa: [], eventos: [] }),
  ]);
  return {
    semana,
    rotulo: rotuloSemana(semana),
    elogios,
    sentimento,
    desafios,
    album,
    proximos: {
      aniversarios: agenda.aniversarios.map((a) => ({ nome: a.nome, dia: a.dia, falta: a.falta })),
      casa: agenda.casa.map((c) => ({ nome: c.nome, anos: c.anos, dia: c.dia, falta: c.falta })),
      eventos: agenda.eventos.slice(0, 4).map((e) => ({ titulo: e.titulo, emoji: e.emoji, data: e.data.split("-").reverse().slice(0, 2).join("/"), hora: e.hora, falta: e.falta })),
    },
  };
}

// ---------------- Texto ----------------
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const quando = (falta) => (falta === 0 ? "hoje" : falta === 1 ? "amanhã" : `em ${falta} dias`);

// Versão sem IA: sempre funciona.
export function textoModelo(d) {
  const destaques = [];
  if (d.elogios.total)
    destaques.push({ emoji: "💚", texto: `${plural(d.elogios.total, "elogio", "elogios")} para ${plural(d.elogios.pessoas, "pessoa", "pessoas")} do time. Reconhecimento em alta!` });
  if (d.sentimento.total)
    destaques.push({ emoji: "🌡️", texto: `${plural(d.sentimento.total, "pessoa contou", "pessoas contaram")} como foi a semana${d.sentimento.palavraDaSemana ? `. Palavra da semana: “${d.sentimento.palavraDaSemana}”` : ""}.` });
  for (const x of d.desafios.desafios.slice(0, 2))
    destaques.push({ emoji: "🧩", texto: x.respostas ? `Desafio da semana: ${plural(x.respostas, "resposta", "respostas")} e ${plural(x.acertos, "acerto", "acertos")}.` : "Tem Desafio da semana no ar — ainda dá tempo de responder!" });
  if (d.desafios.podio.length)
    destaques.push({ emoji: "🏆", texto: `Pódio de ${d.desafios.rotuloMes}: ${d.desafios.podio.map((p, i) => `${i + 1}º ${p.nome} (${p.pontos})`).join(", ")}.` });
  if (d.album.fotos)
    destaques.push({ emoji: "📸", texto: `${plural(d.album.fotos, "foto nova", "fotos novas")} no álbum${d.album.momentos.length ? ` (${d.album.momentos.slice(0, 2).join(", ")})` : ""}.` });
  for (const a of d.proximos.aniversarios.slice(0, 3)) destaques.push({ emoji: "🎂", texto: `Aniversário de ${a.nome} ${quando(a.falta)} (${a.dia}).` });
  for (const c of d.proximos.casa.slice(0, 2)) destaques.push({ emoji: "🏅", texto: `${c.nome} completa ${plural(c.anos, "ano", "anos")} de Toca ${quando(c.falta)}.` });
  for (const e of d.proximos.eventos.slice(0, 2)) destaques.push({ emoji: e.emoji || "📅", texto: `${e.titulo}: ${e.data}${e.hora ? ` às ${e.hora}` : ""}.` });
  return {
    titulo: d.elogios.total || d.sentimento.total ? "A semana na Toca" : "Semana tranquila na Toca",
    abertura: destaques.length ? `Confira o que rolou na semana de ${d.rotulo.replace(/^Semana \d+ · /, "")} e o que vem por aí.` : "Foi uma semana silenciosa por aqui. Que tal começar esta deixando um elogio para alguém do time?",
    destaques: destaques.slice(0, 7),
    fechamento: "Boa semana, caçadores! 🐞",
  };
}

const NEWS_SYSTEM = `Você escreve o "Toca News", um boletim semanal curto e animado para a equipe "Toca dos Bug Hunters" (time de testes/QA).
Regras:
- Português do Brasil, tom leve e caloroso, frases curtas. Pode usar humor de leve sobre bugs e testes.
- Use SOMENTE os fatos dos dados recebidos. Não invente números, nomes, eventos nem conquistas.
- Se algo veio zerado, não comente (ou incentive de leve a participação, sem cobrar).
- Nunca cite frases de pessoas nem atribua sentimentos a alguém específico.
- "titulo": até 60 caracteres. "abertura": 1 ou 2 frases. "destaques": de 3 a 6 itens, cada um com um emoji e uma frase de até 140 caracteres. "fechamento": 1 frase.
- Datas no formato dd/mm. Aniversários e tempo de casa são motivo de festa.`;
const NEWS_SCHEMA = {
  type: "OBJECT",
  properties: {
    titulo: { type: "STRING" },
    abertura: { type: "STRING" },
    destaques: { type: "ARRAY", items: { type: "OBJECT", properties: { emoji: { type: "STRING" }, texto: { type: "STRING" } }, required: ["emoji", "texto"] } },
    fechamento: { type: "STRING" },
  },
  required: ["titulo", "abertura", "destaques", "fechamento"],
};

const limpa = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function normalizaTexto(t) {
  const destaques = (Array.isArray(t?.destaques) ? t.destaques : [])
    .map((x) => ({ emoji: limpa(x?.emoji, 8) || "•", texto: limpa(x?.texto, 200) }))
    .filter((x) => x.texto)
    .slice(0, 8);
  return { titulo: limpa(t?.titulo, 80) || "A semana na Toca", abertura: limpa(t?.abertura, 400), destaques, fechamento: limpa(t?.fechamento, 200) };
}

async function escrever(dados) {
  const temAlgo = dados.elogios.total || dados.sentimento.total || dados.desafios.desafios.length || dados.album.fotos;
  if (!iaConfig().demoMode && temAlgo) {
    try {
      const { data, model, provider } = await gerarJSON({ system: NEWS_SYSTEM, texto: "Dados da semana (JSON):\n" + JSON.stringify(dados), schema: NEWS_SCHEMA, totalMs: 60_000 });
      const t = normalizaTexto(data);
      if (t.destaques.length >= 2) return { ...t, fonte: "ia", modelo: `${provider || ""} ${model || ""}`.trim() };
    } catch (e) {
      console.error("Toca News: IA falhou, usando o modelo fixo:", e?.message || e);
    }
  }
  return { ...normalizaTexto(textoModelo(dados)), fonte: "modelo", modelo: null };
}

export async function gerarEdicao(semana) {
  const dados = await dadosDaSemana(semana);
  const texto = await escrever(dados);
  const edicao = {
    id: crypto.randomUUID(),
    semana,
    rotulo: dados.rotulo,
    ...texto,
    numeros: { elogios: dados.elogios.total, sentimentos: dados.sentimento.total, fotos: dados.album.fotos, desafios: dados.desafios.desafios.length },
    geradaEm: new Date().toISOString(),
    oculta: false,
    notificadaEm: null,
  };
  await alterar((doc) => ((doc.edicoes = [edicao, ...doc.edicoes.filter((e) => e.semana !== semana)]), doc));
  return edicao;
}

const publica = (e) => ({ id: e.id, semana: e.semana, rotulo: e.rotulo, titulo: e.titulo, abertura: e.abertura, destaques: e.destaques, fechamento: e.fechamento, numeros: e.numeros, geradaEm: e.geradaEm });

async function notificar(e) {
  const r = await enviarMensagem({
    title: `📰 Toca News: ${e.titulo}`.slice(0, 80),
    body: (e.abertura || e.destaques[0]?.texto || "Saiu o resumo da semana!").slice(0, 160),
    url: "/inicio.html#news",
    tag: "vv-news",
  });
  await alterar((doc) => {
    const x = doc.edicoes.find((y) => y.id === e.id);
    if (x) x.notificadaEm = new Date().toISOString();
    return doc;
  });
  return r;
}

// ---------------- Rotas ----------------
export const noticiasRouter = express.Router();
noticiasRouter.use(express.json({ limit: "16kb" }));
noticiasRouter.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));

// Público: últimas edições visíveis (a primeira é a atual).
noticiasRouter.get("/", async (_req, res) => {
  try {
    const doc = await ler();
    res.json({ edicoes: doc.edicoes.filter((e) => !e.oculta).slice(0, 6).map(publica) });
  } catch (e) {
    console.error("Erro ao ler o Toca News:", e);
    res.status(500).json({ error: "Não consegui carregar o Toca News agora." });
  }
});

// Vercel Cron: segunda de manhã gera a edição da semana passada e avisa o time.
noticiasRouter.get("/cron", async (req, res) => {
  try {
    if (!cronAutorizado(req)) return res.status(401).json({ error: "Não autorizado." });
    if (diaSemanaSP() !== "Mon") return res.json({ ok: true, pulado: "não é segunda" });
    const semana = semanaPassada();
    const doc = await ler(true);
    if (doc.edicoes.some((e) => e.semana === semana)) return res.json({ ok: true, pulado: "edição já existe" });
    const edicao = await gerarEdicao(semana);
    const envio = await notificar(edicao).catch((e) => (console.error("Toca News: falha ao notificar", e), null));
    res.json({ ok: true, semana, fonte: edicao.fonte, envio });
  } catch (e) {
    console.error("Toca News: erro no cron", e);
    res.status(500).json({ error: "Falha ao gerar o Toca News." });
  }
});

// ---------------- Área da Gestora ----------------
noticiasRouter.get("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const doc = await ler(true);
    res.json({ edicoes: doc.edicoes, semanaPassada: semanaPassada(), semanaAtual: semanaAtual(), rotulos: { passada: rotuloSemana(semanaPassada()), atual: rotuloSemana(semanaAtual()) } });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar agora." });
  }
});

const ultimaGeracao = { t: 0 };
noticiasRouter.post("/gestora/gerar", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const semana = req.body?.semana === "atual" ? semanaAtual() : SEMANA_RE.test(String(req.body?.semana || "")) ? String(req.body.semana) : semanaPassada();
    if (semana > semanaAtual()) return res.status(400).json({ error: "Semana inválida." });
    if (Date.now() - ultimaGeracao.t < 20_000) return res.status(429).json({ error: "Aguarde alguns segundos antes de gerar de novo." });
    ultimaGeracao.t = Date.now();
    res.json({ ok: true, edicao: await gerarEdicao(semana) });
  } catch (e) {
    console.error("Toca News: erro ao gerar", e);
    res.status(500).json({ error: "Não consegui gerar a edição agora." });
  }
});

noticiasRouter.put("/gestora/:id", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const b = req.body || {};
    let achou = null;
    await alterar((doc) => {
      const e = doc.edicoes.find((x) => x.id === String(req.params.id));
      if (!e) return doc;
      if (b.titulo !== undefined || b.abertura !== undefined || b.destaques !== undefined || b.fechamento !== undefined) {
        const t = normalizaTexto({ titulo: b.titulo ?? e.titulo, abertura: b.abertura ?? e.abertura, destaques: b.destaques ?? e.destaques, fechamento: b.fechamento ?? e.fechamento });
        Object.assign(e, t, { editadaEm: new Date().toISOString() });
      }
      if (typeof b.oculta === "boolean") e.oculta = b.oculta;
      achou = e;
      return doc;
    });
    if (!achou) return res.status(404).json({ error: "Edição não encontrada." });
    res.json({ ok: true, edicao: achou });
  } catch (e) {
    res.status(500).json({ error: "Não consegui salvar agora." });
  }
});

noticiasRouter.delete("/gestora/:id", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    let tinha = false;
    await alterar((doc) => ((doc.edicoes = doc.edicoes.filter((x) => (x.id === String(req.params.id) ? ((tinha = true), false) : true))), doc));
    if (!tinha) return res.status(404).json({ error: "Edição não encontrada." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

const ultimoAviso = { t: 0 };
noticiasRouter.post("/gestora/:id/notificar", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const e = (await ler(true)).edicoes.find((x) => x.id === String(req.params.id));
    if (!e) return res.status(404).json({ error: "Edição não encontrada." });
    if (e.oculta) return res.status(400).json({ error: "Mostre a edição antes de avisar o time." });
    if (Date.now() - ultimoAviso.t < 5 * 60_000) return res.status(429).json({ error: "Aguarde alguns minutos entre um aviso e outro." });
    ultimoAviso.t = Date.now();
    res.json({ ok: true, ...(await notificar(e)) });
  } catch (e) {
    console.error("Toca News: erro ao notificar", e);
    res.status(500).json({ error: "Falha ao enviar o aviso." });
  }
});

export const _interno = { limpar: () => (cache = { at: 0, doc: null }), semanaPassada, intervalo };
