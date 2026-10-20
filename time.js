// ======================================================
// TIME: ANIVERSÁRIOS, TEMPO DE CASA E AGENDA
//
// A gestora cadastra (Área da Gestora → abas "Aniversários" e "Agenda"):
//  - pessoas: nome, aniversário (dia/mês — o ano NÃO é guardado) e, se quiser, a data de entrada no time;
//  - eventos: confraternização, entrega, feriado, férias, reunião... com data (e data final, se durar dias).
// O Início mostra os aniversários/tempo de casa dos próximos 7 dias e os próximos eventos.
// Para o público só saem nome, dia/mês e anos de casa — nunca a data completa de entrada.
//
// Armazenamento: Vercel Blob em time/_dados.json; local data/time.json.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, gravarDocDireto } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "time/_dados.json";
const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "time.json");

export const TIPOS = {
  confra: { emoji: "🎉", nome: "Confraternização" },
  entrega: { emoji: "🚀", nome: "Entrega / release" },
  reuniao: { emoji: "🗓️", nome: "Reunião / evento" },
  feriado: { emoji: "🏖️", nome: "Feriado / folga" },
  ferias: { emoji: "🌴", nome: "Férias" },
  treinamento: { emoji: "📚", nome: "Treinamento" },
  outro: { emoji: "📌", nome: "Outro" },
};

// Só a gestora grava (poucas vezes): memória longa por instância; quem grava atualiza na hora.
const TTL = 5 * 60_000;
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
  doc = { pessoas: [], eventos: [], ...(doc || {}) };
  cache = { at: Date.now(), doc };
  return doc;
}
// Documento com um só "dono" (a gestora): gravação direta.
async function alterar(fn) {
  const doc = fn(structuredClone(await ler(true)));
  if (usaBlob()) await gravarDocDireto(DOC, doc);
  else {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(doc, null, 2));
  }
  cache = { at: Date.now(), doc };
  return doc;
}

// ---------------- Datas (fuso de São Paulo) ----------------
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); // AAAA-MM-DD
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
// Próxima ocorrência (a partir de hoje) de um dia/mês. 29/02 vira 28/02 em ano não bissexto.
function proxima(md, hoje) {
  let ano = +hoje.slice(0, 4);
  const cria = (a) => {
    let [m, d] = md.split("-").map(Number);
    if (m === 2 && d === 29 && !(a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0))) d = 28;
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let data = cria(ano);
  if (data < hoje) data = cria(++ano);
  return data;
}
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const limpa = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// ---------------- Resumo público (Início) ----------------
export async function resumoPublico(janela = 7) {
  const doc = await ler();
  const hoje = hojeSP();
  const aniversarios = [];
  const casa = [];
  for (const p of doc.pessoas) {
    if (p.aniversario && MD_RE.test(p.aniversario)) {
      const d = proxima(p.aniversario, hoje), falta = diasEntre(hoje, d);
      if (falta <= janela) aniversarios.push({ nome: p.nome, dia: ddmm(d), falta });
    }
    if (p.entrada && DATA_RE.test(p.entrada) && p.entrada < hoje) {
      const d = proxima(p.entrada.slice(5), hoje), falta = diasEntre(hoje, d);
      const anos = +d.slice(0, 4) - +p.entrada.slice(0, 4);
      if (falta <= janela && anos >= 1) casa.push({ nome: p.nome, anos, dia: ddmm(d), falta });
    }
  }
  const ordem = (a, b) => a.falta - b.falta || a.nome.localeCompare(b.nome, "pt-BR");
  const eventos = doc.eventos
    .filter((e) => (e.fim || e.data) >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data) || String(a.hora || "").localeCompare(String(b.hora || "")))
    .slice(0, 6)
    .map((e) => ({ id: e.id, titulo: e.titulo, tipo: e.tipo, emoji: (TIPOS[e.tipo] || TIPOS.outro).emoji, data: e.data, fim: e.fim || null, hora: e.hora || null, descricao: e.descricao || "", falta: Math.max(0, diasEntre(hoje, e.data)), acontecendo: e.data <= hoje }));
  return { hoje, aniversarios: aniversarios.sort(ordem), casa: casa.sort(ordem), eventos };
}

// ---------------- Rotas ----------------
export const timeRouter = express.Router();
timeRouter.use(express.json({ limit: "16kb" }));
const semCache = (_req, res, next) => (res.set("Cache-Control", "no-store"), next());

timeRouter.get("/", semCache, async (_req, res) => {
  try {
    res.json(await resumoPublico());
  } catch (e) {
    console.error("Erro ao ler agenda do time:", e);
    res.status(500).json({ error: "Não consegui carregar a agenda agora." });
  }
});

timeRouter.get("/gestora", semCache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const doc = await ler(true);
    res.json({ ...doc, hoje: hojeSP(), tipos: TIPOS });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar agora." });
  }
});

function dadosPessoa(b) {
  const nome = limpa(b?.nome, 61);
  const aniversario = String(b?.aniversario || "");
  const entrada = String(b?.entrada || "");
  if (nome.length < 2) return { erro: "Escreva o nome." };
  if (nome.length > 60) return { erro: "Nome com no máximo 60 caracteres." };
  if (aniversario && !MD_RE.test(aniversario)) return { erro: "Aniversário inválido." };
  if (entrada && (!DATA_RE.test(entrada) || entrada > hojeSP())) return { erro: "Data de entrada inválida." };
  if (!aniversario && !entrada) return { erro: "Informe o aniversário ou a data de entrada no time." };
  return { nome, aniversario: aniversario || null, entrada: entrada || null };
}
function dadosEvento(b) {
  const titulo = limpa(b?.titulo, 81);
  const tipo = TIPOS[b?.tipo] ? b.tipo : "outro";
  const data = String(b?.data || "");
  const fim = String(b?.fim || "");
  const hora = String(b?.hora || "");
  const descricao = limpa(b?.descricao, 141);
  if (titulo.length < 2) return { erro: "Dê um título ao evento." };
  if (titulo.length > 80) return { erro: "Título com no máximo 80 caracteres." };
  if (!DATA_RE.test(data)) return { erro: "Escolha a data." };
  if (fim && (!DATA_RE.test(fim) || fim < data)) return { erro: "A data final precisa ser depois da inicial." };
  if (hora && !HORA_RE.test(hora)) return { erro: "Horário inválido." };
  if (descricao.length > 140) return { erro: "Descrição com no máximo 140 caracteres." };
  return { titulo, tipo, data, fim: fim && fim !== data ? fim : null, hora: hora || null, descricao };
}

// CRUD genérico das duas listas
function rotas(lista, validar, nome) {
  timeRouter.post(`/gestora/${lista}`, semCache, async (req, res) => {
    if (!(await exigeGestora(req, res))) return;
    const d = validar(req.body);
    if (d.erro) return res.status(400).json({ error: d.erro });
    try {
      const item = { id: crypto.randomUUID(), ...d, criadoEm: new Date().toISOString() };
      await alterar((doc) => ((doc[lista] = [...doc[lista], item].slice(-300)), doc));
      res.json({ ok: true, item });
    } catch (e) {
      console.error(`Erro ao criar ${nome}:`, e);
      res.status(500).json({ error: `Não consegui salvar ${nome} agora.` });
    }
  });
  timeRouter.put(`/gestora/${lista}/:id`, semCache, async (req, res) => {
    if (!(await exigeGestora(req, res))) return;
    const d = validar(req.body);
    if (d.erro) return res.status(400).json({ error: d.erro });
    try {
      let item = null;
      await alterar((doc) => {
        item = doc[lista].find((x) => x.id === String(req.params.id));
        if (item) Object.assign(item, d);
        return doc;
      });
      if (!item) return res.status(404).json({ error: "Não encontrado." });
      res.json({ ok: true, item });
    } catch (e) {
      res.status(500).json({ error: "Não consegui salvar agora." });
    }
  });
  timeRouter.delete(`/gestora/${lista}/:id`, semCache, async (req, res) => {
    if (!(await exigeGestora(req, res))) return;
    try {
      let tinha = false;
      await alterar((doc) => ((doc[lista] = doc[lista].filter((x) => (x.id === String(req.params.id) ? ((tinha = true), false) : true))), doc));
      if (!tinha) return res.status(404).json({ error: "Não encontrado." });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Não consegui remover agora." });
    }
  });
}
rotas("pessoas", dadosPessoa, "a pessoa");
rotas("eventos", dadosEvento, "o evento");

export const _interno = { limpar: () => (cache = { at: 0, doc: null }), proxima, diasEntre };
