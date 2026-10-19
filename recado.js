// ======================================================
// RECADO DA CHEFA
//
// A gestora (senha SENTIMENTO_GESTORA_KEY) escreve um recado no painel dela — ex.:
// "Bem-vindos à Toca! Que seja uma semana abençoada! 🙏" — e ele aparece num pop-up
// para todo mundo que abrir a Toca dos Bug Hunters (PC ou app).
//
// Frequência:
//  - "uma-vez": cada pessoa vê uma vez (volta a aparecer quando o recado muda);
//  - "diario":  uma vez por dia;
//  - "sempre":  toda vez que abrir a Toca.
// O controle de "já vi" fica no navegador de cada pessoa (localStorage).
//
// Armazenamento: Vercel Blob em recado/_dados.json; local data/recado.json.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, gravarDocDireto, _colecao } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "recado/_dados.json";
const FREQ = ["uma-vez", "diario", "sempre"];
const PADRAO = { ativo: false, id: null, titulo: "Recado da Chefa!", mensagem: "", assinatura: "", frequencia: "uma-vez", atualizadoEm: null };

const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "recado.json");

const TTL = 60_000; // lido a cada abertura de página; quem salva já atualiza a memória na hora
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
  doc = { ...PADRAO, ...(doc || {}) };
  cache = { at: Date.now(), doc };
  return doc;
}
async function salvar(doc) {
  if (usaBlob()) await gravarDocDireto(DOC, doc);
  else {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(doc, null, 2));
  }
  cache = { at: Date.now(), doc };
  return doc;
}

// Mantém quebras de linha (no máximo 2 seguidas); tira caracteres de controle.
const limpaTexto = (v, max) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max + 1);
const limpaLinha = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const publico = (d) => ({ ativo: d.ativo && !!d.mensagem, id: d.id, titulo: d.titulo, mensagem: d.mensagem, assinatura: d.assinatura, frequencia: d.frequencia, atualizadoEm: d.atualizadoEm });

export const recadoRouter = express.Router();
recadoRouter.use(express.json({ limit: "8kb" }));

recadoRouter.get("/", async (_req, res) => {
  try {
    const d = await ler();
    res.set("Cache-Control", "no-store");
    res.json(d.ativo && d.mensagem ? publico(d) : { ativo: false });
  } catch (e) {
    console.error("Erro ao ler recado:", e);
    res.status(500).json({ ativo: false });
  }
});

recadoRouter.get("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ...(await ler(true)), frequencias: FREQ });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar o recado." });
  }
});

recadoRouter.put("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const atual = await ler(true);
    const titulo = limpaLinha(req.body?.titulo, 60) || "Recado da Chefa!";
    const mensagem = limpaTexto(req.body?.mensagem, 600);
    const assinatura = limpaLinha(req.body?.assinatura, 60);
    const frequencia = FREQ.includes(req.body?.frequencia) ? req.body.frequencia : "uma-vez";
    const ativo = !!req.body?.ativo;
    if (mensagem.length > 600) return res.status(400).json({ error: "Use no máximo 600 caracteres na mensagem." });
    if (ativo && mensagem.length < 2) return res.status(400).json({ error: "Escreva a mensagem do recado." });
    if (/<\s*script|javascript:/i.test(mensagem + titulo + assinatura)) return res.status(400).json({ error: "Texto não permitido." });
    // Um "id" novo sempre que o conteúdo muda: é o que faz o recado aparecer de novo para quem já viu.
    const mudou = titulo !== atual.titulo || mensagem !== atual.mensagem || assinatura !== atual.assinatura || frequencia !== atual.frequencia;
    const doc = {
      ativo,
      id: mudou || !atual.id ? crypto.randomUUID() : atual.id,
      titulo,
      mensagem,
      assinatura,
      frequencia,
      atualizadoEm: mudou || !atual.atualizadoEm ? new Date().toISOString() : atual.atualizadoEm,
    };
    await salvar(doc);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, recado: doc });
  } catch (e) {
    console.error("Erro ao salvar recado:", e);
    res.status(500).json({ error: "Não consegui salvar o recado agora." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); cache = { at: 0, doc: null }; } };
