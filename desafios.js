// ======================================================
// DESAFIO DA SEMANA (quiz do time)
//
// A gestora publica uma pergunta com 2 a 4 alternativas (uma certa) e uma explicação.
// Cada pessoa responde uma vez (com o próprio nome) e vê na hora se acertou.
// Ranking do mês: 1 ponto por acerto (respostas do mês corrente, fuso de São Paulo).
// Ao publicar um desafio novo, o anterior é encerrado e a resposta certa fica visível para todos.
//
// Armazenamento: Vercel Blob em desafios/_dados.json; local data/desafios.json.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, atualizarDoc } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "desafios/_dados.json";
const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "desafios.json");
const PERGUNTA_MAX = 200, OPCAO_MAX = 100, EXPLICACAO_MAX = 300, NOME_MAX = 40;

const TTL = 15_000;
let cache = { at: 0, doc: null };
const vazio = () => ({ desafios: [], respostas: {} });
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
  doc = { ...vazio(), ...(doc || {}) };
  cache = { at: Date.now(), doc };
  return doc;
}
async function alterar(fn) {
  let doc;
  if (usaBlob()) doc = await atualizarDoc(DOC, (cur) => fn({ ...vazio(), ...(cur || {}) }));
  else {
    doc = fn(structuredClone(await ler(true)));
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(doc, null, 2));
  }
  cache = { at: Date.now(), doc };
  return doc;
}

// ---------------- Utilidades ----------------
const limpa = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const chaveNome = (n) => limpa(n, 80).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hash = (c) => crypto.createHash("sha256").update(String(c)).digest("hex");
const leitorDe = (req) => {
  const l = String(req.get("x-leitor") || "");
  return /^[a-f0-9]{16,64}$/i.test(l) ? hash("desafio:" + l) : null;
};
const mesSP = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(d); // AAAA-MM
const rotuloMes = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

const limite = new Map();
function freio(req, max = 20, janela = 60_000) {
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const agora = Date.now();
  const l = (limite.get(ip) || []).filter((t) => agora - t < janela);
  if (l.length >= max) return false;
  l.push(agora);
  limite.set(ip, l);
  if (limite.size > 5000) limite.clear();
  return true;
}

function ranking(doc, mes = mesSP()) {
  const m = new Map();
  for (const [, lista] of Object.entries(doc.respostas || {}))
    for (const r of lista) {
      if (mesSP(new Date(r.em)) !== mes) continue;
      const k = r.nomeChave;
      const p = m.get(k) || { nome: r.nome, pontos: 0, respostas: 0, ultima: r.em };
      p.respostas++;
      if (r.certo) p.pontos++;
      if (r.em > p.ultima) (p.ultima = r.em), (p.nome = r.nome);
      m.set(k, p);
    }
  return [...m.values()]
    .filter((p) => p.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.respostas - b.respostas || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 15)
    .map(({ nome, pontos, respostas }) => ({ nome, pontos, respostas }));
}
const estat = (doc, d) => {
  const l = doc.respostas[d.id] || [];
  const porOpcao = d.opcoes.map((_, i) => l.filter((r) => r.opcao === i).length);
  return { total: l.length, acertos: l.filter((r) => r.certo).length, porOpcao };
};
const publicoEncerrado = (doc, d) => ({ id: d.id, pergunta: d.pergunta, opcoes: d.opcoes, correta: d.correta, explicacao: d.explicacao, criadoEm: d.criadoEm, encerradoEm: d.encerradoEm, ...estat(doc, d) });

// ---------------- Rotas públicas ----------------
export const desafiosRouter = express.Router();
desafiosRouter.use(express.json({ limit: "8kb" }));
const semCache = (_req, res, next) => (res.set("Cache-Control", "no-store"), next());

desafiosRouter.get("/", semCache, async (req, res) => {
  try {
    const doc = await ler();
    const leitor = leitorDe(req);
    const aberto = doc.desafios.find((d) => !d.encerradoEm);
    let atual = null;
    if (aberto) {
      const minha = leitor && (doc.respostas[aberto.id] || []).find((r) => r.leitor === leitor);
      const st = estat(doc, aberto);
      atual = { id: aberto.id, pergunta: aberto.pergunta, opcoes: aberto.opcoes, criadoEm: aberto.criadoEm, total: st.total };
      if (minha) Object.assign(atual, { minha: { opcao: minha.opcao, certo: minha.certo, nome: minha.nome }, correta: aberto.correta, explicacao: aberto.explicacao, acertos: st.acertos, porOpcao: st.porOpcao });
    }
    const anteriores = doc.desafios.filter((d) => d.encerradoEm).sort((a, b) => b.encerradoEm.localeCompare(a.encerradoEm)).slice(0, 5).map((d) => publicoEncerrado(doc, d));
    const mes = mesSP();
    res.json({ atual, anteriores, ranking: ranking(doc, mes), mes, rotuloMes: rotuloMes(mes) });
  } catch (e) {
    console.error("Erro ao ler desafios:", e);
    res.status(500).json({ error: "Não consegui carregar o desafio agora." });
  }
});

desafiosRouter.post("/:id/responder", semCache, async (req, res) => {
  try {
    const leitor = leitorDe(req);
    if (!leitor) return res.status(400).json({ error: "Navegador sem identificação. Recarregue a página." });
    if (!freio(req)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    const nome = limpa(req.body?.nome, NOME_MAX + 1);
    const opcao = Number(req.body?.opcao);
    if (nome.length < 2) return res.status(400).json({ error: "Escreva o seu nome para entrar no ranking." });
    if (nome.length > NOME_MAX) return res.status(400).json({ error: `Nome com no máximo ${NOME_MAX} caracteres.` });
    const id = String(req.params.id);
    let resultado = null, erro = null;
    await alterar((doc) => {
      const d = doc.desafios.find((x) => x.id === id);
      if (!d) return (erro = [404, "Desafio não encontrado."]), doc;
      if (d.encerradoEm) return (erro = [409, "Este desafio já foi encerrado."]), doc;
      if (!Number.isInteger(opcao) || opcao < 0 || opcao >= d.opcoes.length) return (erro = [400, "Escolha uma das alternativas."]), doc;
      const l = (doc.respostas[id] ||= []);
      const k = chaveNome(nome);
      if (l.some((r) => r.leitor === leitor || r.nomeChave === k)) return (erro = [409, "Você já respondeu este desafio. 😉"]), doc;
      const r = { id: crypto.randomUUID(), nome, nomeChave: k, leitor, opcao, certo: opcao === d.correta, em: new Date().toISOString() };
      l.push(r);
      if (l.length > 400) l.splice(0, l.length - 400);
      resultado = { certo: r.certo, opcao, correta: d.correta, explicacao: d.explicacao };
      return doc;
    });
    if (erro) return res.status(erro[0]).json({ error: erro[1] });
    res.json({ ok: true, ...resultado });
  } catch (e) {
    console.error("Erro ao responder desafio:", e);
    res.status(500).json({ error: "Não consegui registrar sua resposta agora." });
  }
});

// ---------------- Gestora ----------------
desafiosRouter.get("/gestora", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const doc = await ler(true);
    const desafios = doc.desafios
      .slice()
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      .map((d) => ({ ...d, ...estat(doc, d), respostas: (doc.respostas[d.id] || []).map(({ id, nome, opcao, certo, em }) => ({ id, nome, opcao, certo, em })) }));
    const mes = mesSP();
    res.json({ desafios, ranking: ranking(doc, mes), rotuloMes: rotuloMes(mes) });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar agora." });
  }
});

desafiosRouter.post("/gestora", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const pergunta = limpa(req.body?.pergunta, PERGUNTA_MAX + 1);
  const opcoes = (Array.isArray(req.body?.opcoes) ? req.body.opcoes : []).map((o) => limpa(o, OPCAO_MAX + 1)).filter(Boolean);
  const correta = Number(req.body?.correta);
  const explicacao = limpa(req.body?.explicacao, EXPLICACAO_MAX + 1);
  if (pergunta.length < 5) return res.status(400).json({ error: "Escreva a pergunta (pelo menos 5 caracteres)." });
  if (pergunta.length > PERGUNTA_MAX) return res.status(400).json({ error: `Pergunta com no máximo ${PERGUNTA_MAX} caracteres.` });
  if (opcoes.length < 2 || opcoes.length > 4) return res.status(400).json({ error: "Coloque de 2 a 4 alternativas." });
  if (opcoes.some((o) => o.length > OPCAO_MAX)) return res.status(400).json({ error: `Cada alternativa com no máximo ${OPCAO_MAX} caracteres.` });
  if (new Set(opcoes.map((o) => o.toLowerCase())).size !== opcoes.length) return res.status(400).json({ error: "As alternativas precisam ser diferentes." });
  if (!Number.isInteger(correta) || correta < 0 || correta >= opcoes.length) return res.status(400).json({ error: "Marque qual alternativa é a certa." });
  if (explicacao.length > EXPLICACAO_MAX) return res.status(400).json({ error: `Explicação com no máximo ${EXPLICACAO_MAX} caracteres.` });
  try {
    const d = { id: crypto.randomUUID(), pergunta, opcoes, correta, explicacao, criadoEm: new Date().toISOString(), encerradoEm: null };
    await alterar((doc) => {
      const agora = new Date().toISOString();
      for (const x of doc.desafios) if (!x.encerradoEm) x.encerradoEm = agora;
      doc.desafios = [...doc.desafios, d].slice(-100);
      const ids = new Set(doc.desafios.map((x) => x.id));
      for (const k of Object.keys(doc.respostas)) if (!ids.has(k)) delete doc.respostas[k];
      return doc;
    });
    res.json({ ok: true, desafio: d });
  } catch (e) {
    console.error("Erro ao publicar desafio:", e);
    res.status(500).json({ error: "Não consegui publicar agora." });
  }
});

desafiosRouter.post("/gestora/:id/encerrar", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    let achou = false;
    await alterar((doc) => {
      const d = doc.desafios.find((x) => x.id === String(req.params.id));
      if (d && !d.encerradoEm) (d.encerradoEm = new Date().toISOString()), (achou = true);
      return doc;
    });
    if (!achou) return res.status(404).json({ error: "Desafio não encontrado ou já encerrado." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui encerrar agora." });
  }
});

desafiosRouter.delete("/gestora/:id", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    let achou = false;
    await alterar((doc) => {
      doc.desafios = doc.desafios.filter((x) => (x.id === id ? ((achou = true), false) : true));
      delete doc.respostas[id];
      return doc;
    });
    if (!achou) return res.status(404).json({ error: "Desafio não encontrado." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

desafiosRouter.delete("/gestora/:id/resposta/:rid", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    await alterar((doc) => {
      const l = doc.respostas[String(req.params.id)];
      if (l) doc.respostas[String(req.params.id)] = l.filter((r) => r.id !== String(req.params.rid));
      return doc;
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui remover agora." });
  }
});

// Resumo de um período para o Toca News: desafios publicados no período e o pódio do mês.
export async function resumoDesafios(desde, ate) {
  const doc = await ler();
  const desafios = doc.desafios
    .filter((d) => d.criadoEm >= desde && d.criadoEm < ate)
    .map((d) => {
      const st = estat(doc, d);
      return { pergunta: d.pergunta, respostas: st.total, acertos: st.acertos, encerrado: !!d.encerradoEm };
    });
  const mes = mesSP(new Date(Date.parse(ate) - 1));
  return { desafios, podio: ranking(doc, mes).slice(0, 3), rotuloMes: rotuloMes(mes) };
}

export const _interno = { limpar: () => (cache = { at: 0, doc: null }) };
