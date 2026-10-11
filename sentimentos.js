// ======================================================
// SENTIMENTO DA SEMANA
// Cada pessoa da equipe informa uma palavra que define a sua semana.
// A equipe vê a nuvem da semana atual; a gestora tem um painel com senha
// (SENTIMENTO_GESTORA_KEY) com histórico, ranking e remoção.
//
// ANÔNIMO: nenhum nome, IP ou identificador é gravado. Cada resposta guarda
// só a palavra, a semana e a data/hora.
//
// Armazenamento: Vercel Blob em sentimentos/<semana>/<arquivo>.json quando
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

let blobSdk = null;
let blobAccess = null;
const blobCache = new Map(); // pathname -> resposta (respostas não mudam)
const sdk = async () => (blobSdk ||= await import("@vercel/blob"));
const ordemAcesso = () =>
  blobAccess ? [blobAccess] : [...new Set([process.env.ELOGIOS_BLOB_ACCESS || "private", "public"])];
const erroDeAcesso = (e) => /access|private|public/i.test(String(e?.message));

async function listarTudo(prefix) {
  const { list } = await sdk();
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return blobs;
}

const blobStore = {
  kind: () => "vercel-blob",
  async semanas() {
    const c = {};
    for (const b of await listarTudo(PREFIX)) {
      const s = b.pathname.slice(PREFIX.length).split("/")[0];
      if (SEMANA_RE.test(s)) c[s] = (c[s] || 0) + 1;
    }
    return c;
  },
  async daSemana(semana) {
    const { get } = await sdk();
    const blobs = await listarTudo(`${PREFIX}${semana}/`);
    await Promise.all(
      blobs
        .filter((b) => !blobCache.has(b.pathname))
        .map(async (b) => {
          for (const access of ordemAcesso()) {
            try {
              const r = await get(b.pathname, { access, useCache: false });
              if (!r) return;
              blobAccess = access;
              blobCache.set(b.pathname, { ...JSON.parse(await new Response(r.stream).text()), _path: b.pathname });
              return;
            } catch (e) {
              if (!erroDeAcesso(e)) return console.error("Sentimento ilegível:", b.pathname, e?.message);
            }
          }
        })
    );
    const vivos = new Set(blobs.map((b) => b.pathname));
    return [...blobCache.values()].filter((r) => r.semana === semana && vivos.has(r._path));
  },
  async adicionar(item) {
    const { put } = await sdk();
    const pathname = `${PREFIX}${item.semana}/${item.criadoEm.replace(/[:.]/g, "-")}-${item.id}.json`;
    let ultimo;
    for (const access of ordemAcesso()) {
      try {
        await put(pathname, JSON.stringify(item), { access, contentType: "application/json", addRandomSuffix: false });
        blobAccess = access;
        blobCache.set(pathname, { ...item, _path: pathname });
        return;
      } catch (e) {
        ultimo = e;
        if (!erroDeAcesso(e)) throw e;
      }
    }
    throw ultimo;
  },
  async remover(semana, id) {
    const { del } = await sdk();
    const alvo = (await this.daSemana(semana)).find((r) => r.id === id);
    if (alvo) {
      await del(alvo._path);
      blobCache.delete(alvo._path);
    }
  },
};

const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

// Cache curto por semana (várias pessoas atualizando a tela ao mesmo tempo).
const cache = new Map();
async function respostasDa(semana, force = false) {
  const c = cache.get(semana);
  if (!force && c && Date.now() - c.at < 3000) return c.data;
  const data = await store().daSemana(semana);
  cache.set(semana, { at: Date.now(), data });
  return data;
}
const invalidar = (semana) => cache.delete(semana);

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
    if (Date.now() - (ultimoEnvio.get(ip) || 0) < 3000) {
      return res.status(429).json({ error: "Aguarde alguns segundos e tente de novo." });
    }
    ultimoEnvio.set(ip, Date.now());
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const semana = semanaDe();
    const item = { id: crypto.randomUUID().slice(0, 8), semana, palavra: v.palavra, criadoEm: new Date().toISOString() };
    await store().adicionar(item);
    invalidar(semana);
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
    await store().remover(semana, String(req.params.id));
    invalidar(semana);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao remover sentimento:", e);
    res.status(500).json({ error: "Não consegui remover a palavra." });
  }
});

// Usado nos testes
export const _interno = { semanaDe, rotuloSemana, validaPalavra, contar, blobStore, setSdk: (m) => { blobSdk = m; blobAccess = null; blobCache.clear(); cache.clear(); } };
