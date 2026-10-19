// ======================================================
// CAIXA DE SUGESTÕES (anônima)
//
// Qualquer pessoa da equipe manda uma sugestão (até 300 caracteres), sem se identificar.
// A gestora (mesma senha do painel do Sentimento: SENTIMENTO_GESTORA_KEY) vê todas,
// muda o status (nova → em análise → feito / não vamos fazer), responde e decide se a
// resposta aparece para a equipe no mural "Ouvimos você".
//
// ANÔNIMO: não gravamos nome, e-mail nem IP. Quem enviou guarda no próprio navegador o id
// da sugestão para acompanhar o status e a resposta.
//
// Armazenamento: Vercel Blob em sugestoes/_dados.json (um arquivo só, ver colecao.js)
// quando BLOB_READ_WRITE_TOKEN existe; senão data/sugestoes.json (local) ou /tmp na Vercel.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, atualizarDoc, _colecao } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "sugestoes/_dados.json";
const TEXTO_MAX = 300;
const RESPOSTA_MAX = 500;
const STATUS = ["nova", "analise", "feito", "nao"];

const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "sugestoes.json");

const fileStore = {
  kind: () => (process.env.VERCEL ? "temporario" : "arquivo-local"),
  async todas() {
    try {
      return JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      return [];
    }
  },
  async alterar(fn) {
    const nova = fn(await this.todas());
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(nova, null, 2));
    return nova;
  },
};

const blobStore = {
  kind: () => "vercel-blob",
  async todas() {
    return (await lerDoc(DOC))?.itens || [];
  },
  async alterar(fn) {
    return (await atualizarDoc(DOC, (cur) => ({ itens: fn(cur?.itens || []) }))).itens;
  },
};

const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

// Cache curto: várias pessoas com a tela aberta não geram uma leitura cada.
const TTL = 20_000;
let cache = { at: 0, itens: null };
async function todas(force = false) {
  if (!force && cache.itens && Date.now() - cache.at < TTL) return cache.itens;
  const itens = await store().todas();
  cache = { at: Date.now(), itens };
  return itens;
}
async function alterar(fn) {
  const itens = await store().alterar(fn);
  cache = { at: Date.now(), itens };
  return itens;
}

const limpa = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

// O que a equipe pode ver de uma sugestão (nunca a chave nem dados internos).
const publica = (s) => ({
  id: s.id,
  texto: s.texto,
  status: s.status,
  resposta: s.publica ? s.resposta || "" : "",
  respondidaEm: s.publica ? s.respondidaEm || null : null,
  criadoEm: s.criadoEm,
});

export const sugestoesRouter = express.Router();
sugestoesRouter.use(express.json({ limit: "4kb" }));
sugestoesRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Mural "Ouvimos você": só sugestões que a gestora respondeu e marcou como públicas.
sugestoesRouter.get("/", async (_req, res) => {
  try {
    const itens = await todas();
    const mural = itens
      .filter((s) => s.publica && s.resposta)
      .sort((a, b) => String(b.respondidaEm || "").localeCompare(String(a.respondidaEm || "")))
      .slice(0, 50)
      .map(publica);
    res.json({
      recebidas: itens.length,
      respondidas: itens.filter((s) => s.resposta).length,
      feitas: itens.filter((s) => s.status === "feito").length,
      mural,
      armazenamento: store().kind(),
    });
  } catch (e) {
    console.error("Erro ao ler sugestões:", e);
    res.status(500).json({ error: "Não consegui carregar as sugestões agora." });
  }
});

// Quem enviou acompanha as próprias sugestões (precisa do id e da chave guardados no navegador).
sugestoesRouter.post("/minhas", async (req, res) => {
  try {
    const pares = (Array.isArray(req.body?.itens) ? req.body.itens : []).slice(0, 30);
    const itens = await todas(true);
    const out = [];
    for (const p of pares) {
      const s = itens.find((x) => x.id === String(p?.id || ""));
      if (s && s.chave && s.chave === hash(p?.chave)) {
        out.push({ id: s.id, texto: s.texto, status: s.status, resposta: s.resposta || "", respondidaEm: s.respondidaEm || null, criadoEm: s.criadoEm });
      }
    }
    res.json({ itens: out });
  } catch (e) {
    console.error("Erro ao ler minhas sugestões:", e);
    res.status(500).json({ error: "Não consegui carregar as suas sugestões." });
  }
});

const hash = (c) => crypto.createHash("sha256").update(String(c ?? "")).digest("hex");
const ultimoEnvio = new Map(); // só em memória, para frear envios repetidos; nunca é gravado

sugestoesRouter.post("/", async (req, res) => {
  try {
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const janela = (ultimoEnvio.get(ip) || []).filter((t) => agora - t < 60_000);
    if (janela.length >= 5) return res.status(429).json({ error: "Muitas sugestões seguidas. Aguarde um minuto." });
    janela.push(agora);
    ultimoEnvio.set(ip, janela);
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const texto = limpa(req.body?.texto, TEXTO_MAX + 1);
    if (texto.length < 5) return res.status(400).json({ error: "Escreva a sua sugestão (pelo menos 5 caracteres)." });
    if (texto.length > TEXTO_MAX) return res.status(400).json({ error: `Use no máximo ${TEXTO_MAX} caracteres.` });
    if (!/\p{L}/u.test(texto)) return res.status(400).json({ error: "Escreva com palavras, por favor." });
    if (/https?:\/\/|www\./i.test(texto)) return res.status(400).json({ error: "Não use links na sugestão." });

    const chave = crypto.randomBytes(16).toString("hex");
    const item = { id: crypto.randomUUID(), texto, status: "nova", resposta: "", publica: false, criadoEm: new Date().toISOString(), chave: hash(chave) };
    await alterar((l) => [...l, item].slice(-500));
    res.json({ ok: true, id: item.id, chave });
  } catch (e) {
    console.error("Erro ao salvar sugestão:", e);
    res.status(500).json({ error: "Não consegui enviar agora. Tente de novo em instantes." });
  }
});

// ---------------- Gestora ----------------

sugestoesRouter.get("/gestora", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const itens = (await todas(true))
      .slice()
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      .map((s) => ({ id: s.id, texto: s.texto, status: s.status, resposta: s.resposta || "", publica: !!s.publica, criadoEm: s.criadoEm, respondidaEm: s.respondidaEm || null }));
    res.json({ itens, status: STATUS });
  } catch (e) {
    console.error("Erro ao listar sugestões:", e);
    res.status(500).json({ error: "Não consegui carregar as sugestões." });
  }
});

sugestoesRouter.put("/gestora/:id", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    const status = STATUS.includes(req.body?.status) ? req.body.status : null;
    const resposta = req.body?.resposta === undefined ? undefined : limpa(req.body.resposta, RESPOSTA_MAX);
    const pub = req.body?.publica === undefined ? undefined : !!req.body.publica;
    let achou = null;
    await alterar((l) =>
      l.map((s) => {
        if (s.id !== id) return s;
        const n = { ...s };
        if (status) n.status = status;
        if (resposta !== undefined) {
          if (resposta !== (s.resposta || "")) n.respondidaEm = resposta ? new Date().toISOString() : null;
          n.resposta = resposta;
        }
        if (pub !== undefined) n.publica = pub;
        if (!n.resposta) n.publica = false; // sem resposta não há o que mostrar no mural
        achou = n;
        return n;
      })
    );
    if (!achou) return res.status(404).json({ error: "Sugestão não encontrada." });
    res.json({ ok: true, item: { ...publica(achou), resposta: achou.resposta, publica: achou.publica } });
  } catch (e) {
    console.error("Erro ao atualizar sugestão:", e);
    res.status(500).json({ error: "Não consegui salvar agora." });
  }
});

sugestoesRouter.delete("/gestora/:id", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    let tinha = false;
    await alterar((l) => l.filter((s) => (s.id === id ? ((tinha = true), false) : true)));
    if (!tinha) return res.status(404).json({ error: "Sugestão não encontrada." });
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao remover sugestão:", e);
    res.status(500).json({ error: "Não consegui remover agora." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); cache = { at: 0, itens: null }; } };
