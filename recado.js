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
// Até 3 recados ao mesmo tempo (v0.35): cada um com o próprio liga/desliga e frequência.
// Quem abre a Toca vê os recados ligados em sequência ("1 de 3" → Próximo).
//
// Armazenamento: Vercel Blob em recado/_dados.json ({ recados: [r1, r2, r3] }); local data/recado.json.
// (Versões antigas guardavam um recado só, direto no documento: é convertido no primeiro acesso.)
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
const MAX = 3;
const PADRAO = { ativo: false, id: null, titulo: "Recado da Chefa!", mensagem: "", assinatura: "", frequencia: "uma-vez", atualizadoEm: null };
function normaliza(doc) {
  let recados = Array.isArray(doc?.recados) ? doc.recados : doc && (doc.mensagem !== undefined || doc.ativo !== undefined) ? [doc] : [];
  recados = recados.slice(0, MAX).map((r) => ({ ...PADRAO, ...(r || {}) }));
  while (recados.length < MAX) recados.push({ ...PADRAO });
  return { recados };
}

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
  doc = normaliza(doc);
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
const noAr = (doc) => doc.recados.filter((r) => r.ativo && r.mensagem && r.id).map(publico);

export const recadoRouter = express.Router();
recadoRouter.use(express.json({ limit: "8kb" }));

recadoRouter.get("/", async (_req, res) => {
  try {
    const d = await ler();
    res.set("Cache-Control", "no-store");
    const recados = noAr(d);
    // Campos do primeiro recado no topo: compatível com telas antigas ainda abertas.
    res.json(recados.length ? { ...recados[0], ativo: true, recados } : { ativo: false, recados: [] });
  } catch (e) {
    console.error("Erro ao ler recado:", e);
    res.status(500).json({ ativo: false });
  }
});

recadoRouter.get("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ...(await ler(true)), frequencias: FREQ, max: MAX });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar o recado." });
  }
});

// Salva o recado de um "espaço" (0, 1 ou 2). Sem número = o primeiro (compatível com a tela antiga).
recadoRouter.put(["/gestora", "/gestora/:n"], async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const n = req.params.n === undefined ? 0 : Number(req.params.n);
  if (!Number.isInteger(n) || n < 0 || n >= MAX) return res.status(400).json({ error: "Recado inválido." });
  try {
    const doc = structuredClone(await ler(true));
    const atual = doc.recados[n];
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
    doc.recados[n] = {
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
    res.json({ ok: true, recado: doc.recados[n], recados: doc.recados });
  } catch (e) {
    console.error("Erro ao salvar recado:", e);
    res.status(500).json({ error: "Não consegui salvar o recado agora." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); cache = { at: 0, doc: null }; } };
