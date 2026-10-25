// ======================================================
// ÁLBUM DO TIME
//
// A gestora (senha SENTIMENTO_GESTORA_KEY) publica fotos do time, com legenda e nome do
// álbum (ex.: "Confraternização de outubro"). A equipe vê, curte (1 curtida por navegador)
// e comenta (com o próprio nome). Quem comentou pode apagar o próprio comentário; a gestora
// pode apagar qualquer comentário, editar legendas e apagar fotos.
//
// As fotos são reduzidas NO NAVEGADOR antes do envio (até 1600 px + miniatura de 480 px),
// para caber no limite de 4,5 MB da Vercel e não gastar espaço.
//
// Armazenamento: Vercel Blob privada — dados em album/_dados.json e imagens em
// album/fotos/<id>-g.jpg e <id>-p.jpg. As imagens passam pela rota /api/album/foto/:id,
// com cache longo na CDN (cada foto tem nome único), então visualizações repetidas não
// gastam operações da Blob. Local: data/album.json e data/album/.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lerDoc, atualizarDoc, gravarArquivo, lerArquivo, apagarDocs, _colecao } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "album/_dados.json";
const LEGENDA_MAX = 200;
const ALBUM_MAX = 60; // nome do momento
const DESCRICAO_MAX = 140;
const NOME_MAX = 40;
const COMENTARIO_MAX = 300;
const IMG_MAX = 3_500_000; // bytes, depois de decodificar (a foto grande reduzida fica bem abaixo disso)

const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localDir = () => (process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"));
const localDoc = () => path.join(localDir(), "album.json");
const localFotos = () => path.join(localDir(), "album");
const caminhoFoto = (id, tam) => `album/fotos/${id}-${tam}.jpg`;

// ---------------- Momentos ----------------
// Cada foto pertence a um "momento" (ex.: "Confraternização de outubro", 18/10/2026), criado pela gestora.
// Fotos antigas tinham só um texto em "album": viram momentos com id fixo (o mesmo na leitura e na gravação).
const idLegado = (nome) => "m-" + crypto.createHash("sha1").update(String(nome).toLowerCase()).digest("hex").slice(0, 16);
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
function normaliza(doc) {
  doc.fotos ||= [];
  doc.momentos ||= [];
  for (const f of doc.fotos) {
    if (f.momentoId || !f.album) continue;
    const id = idLegado(f.album);
    if (!doc.momentos.some((m) => m.id === id))
      doc.momentos.push({ id, nome: f.album, data: String(f.criadaEm || "").slice(0, 10) || hojeSP(), descricao: "", criadoEm: f.criadaEm || new Date().toISOString() });
    f.momentoId = id;
  }
  return doc;
}
const momentoPublico = (m, fotos) => {
  const doMomento = fotos.filter((f) => f.momentoId === m.id).sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  return { id: m.id, nome: m.nome, data: m.data, descricao: m.descricao || "", total: doMomento.length, capa: doMomento[0]?.id || null, atualizadoEm: doMomento[0]?.criadaEm || m.criadoEm };
};

// ---------------- Dados ----------------
const TTL = 20_000;
let cache = { at: 0, doc: null };
async function ler(force = false) {
  if (!force && cache.doc && Date.now() - cache.at < TTL) return cache.doc;
  let doc;
  if (usaBlob()) doc = (await lerDoc(DOC)) || { fotos: [] };
  else {
    try {
      doc = JSON.parse(await fs.readFile(localDoc(), "utf8"));
    } catch {
      doc = { fotos: [] };
    }
  }
  normaliza(doc);
  cache = { at: Date.now(), doc };
  return doc;
}
async function alterar(fn) {
  let doc;
  if (usaBlob()) doc = await atualizarDoc(DOC, (cur) => fn(normaliza({ fotos: [], momentos: [], ...(cur || {}) })));
  else {
    doc = fn(normaliza(await ler(true)));
    await fs.mkdir(localDir(), { recursive: true });
    await fs.writeFile(localDoc(), JSON.stringify(doc, null, 2));
  }
  cache = { at: Date.now(), doc };
  return doc;
}

// ---------------- Arquivos ----------------
async function salvarImagem(id, tam, buffer) {
  if (usaBlob()) return gravarArquivo(caminhoFoto(id, tam), buffer, "image/jpeg");
  await fs.mkdir(localFotos(), { recursive: true });
  await fs.writeFile(path.join(localFotos(), `${id}-${tam}.jpg`), buffer);
}
async function abrirImagem(id, tam) {
  if (usaBlob()) {
    const r = await lerArquivo(caminhoFoto(id, tam));
    return r ? Readable.fromWeb(r.stream) : null;
  }
  const f = path.join(localFotos(), `${id}-${tam}.jpg`);
  try {
    await fs.access(f);
    return createReadStream(f);
  } catch {
    return null;
  }
}
async function apagarImagens(id) {
  if (usaBlob()) return apagarDocs([caminhoFoto(id, "g"), caminhoFoto(id, "p")]).catch((e) => console.error("Álbum: falha ao apagar imagens", e?.message));
  for (const t of ["g", "p"]) await fs.rm(path.join(localFotos(), `${id}-${t}.jpg`), { force: true });
}

// ---------------- Utilidades ----------------
const hash = (c) => crypto.createHash("sha256").update(String(c ?? "")).digest("hex");
const mesma = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const limpa = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const leitorDe = (req) => {
  const l = String(req.get("x-leitor") || "");
  return /^[a-f0-9]{16,64}$/i.test(l) ? hash("leitor:" + l) : null;
};
function jpegDeDataUrl(d) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ""));
  if (!m) return null;
  const b = Buffer.from(m[1], "base64");
  // confere a assinatura do JPEG (FF D8 FF)
  if (b.length < 100 || b.length > IMG_MAX || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  return b;
}
const publica = (f, leitor) => ({
  id: f.id,
  legenda: f.legenda || "",
  album: f.album || "",
  momentoId: f.momentoId || null,
  criadaEm: f.criadaEm,
  largura: f.largura || null,
  altura: f.altura || null,
  curtidas: (f.curtidas || []).length,
  curti: !!(leitor && (f.curtidas || []).includes(leitor)),
  comentarios: (f.comentarios || []).map((c) => ({ id: c.id, nome: c.nome, texto: c.texto, criadoEm: c.criadoEm })),
});
const limite = new Map(); // freio só em memória (nunca gravado)
function freio(req, chave, max, janelaMs = 60_000) {
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const k = chave + ":" + ip, agora = Date.now();
  const l = (limite.get(k) || []).filter((t) => agora - t < janelaMs);
  if (l.length >= max) return false;
  l.push(agora);
  limite.set(k, l);
  if (limite.size > 10000) limite.clear();
  return true;
}

// ---------------- Rotas ----------------
// Envio de fotos pausado para poupar a cota da Vercel Blob (operações avançadas
// estouraram em out/2026; a janela de 30 dias folga por volta de 11/11).
// TOCA_FOTOS_PAUSADAS_ATE=AAAA-MM-DD muda a data; "0" libera na hora.
const PAUSA_PADRAO = "2026-11-11";
export function fotosPausadasAte() {
  const ate = String(process.env.TOCA_FOTOS_PAUSADAS_ATE ?? PAUSA_PADRAO).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate)) return null;
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return hoje < ate ? ate : null;
}

export const albumRouter = express.Router();
const json = express.json({ limit: "8kb" });
const sem_cache = (_req, res, next) => (res.set("Cache-Control", "no-store"), next());

albumRouter.get("/", sem_cache, async (req, res) => {
  try {
    const doc = await ler();
    const leitor = leitorDe(req);
    const fotos = doc.fotos.slice().sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).map((f) => publica(f, leitor));
    const momentos = doc.momentos
      .map((m) => momentoPublico(m, doc.fotos))
      .sort((a, b) => b.data.localeCompare(a.data) || String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
    const nomes = Object.fromEntries(doc.momentos.map((m) => [m.id, m.nome]));
    for (const f of fotos) f.album = nomes[f.momentoId] || "";
    res.json({ fotos, momentos, albuns: momentos.filter((m) => m.total).map((m) => ({ nome: m.nome, total: m.total })), envioPausadoAte: fotosPausadasAte(), armazenamento: usaBlob() ? "vercel-blob" : process.env.VERCEL ? "temporario" : "arquivo-local" });
  } catch (e) {
    console.error("Erro ao ler álbum:", e);
    res.status(500).json({ error: "Não consegui carregar o álbum agora." });
  }
});

// Imagem (g = grande, p = miniatura). Nome único por foto → cache "para sempre" na CDN e no navegador.
albumRouter.get("/foto/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(404).end();
    const tam = req.query.t === "p" ? "p" : "g";
    const s = await abrirImagem(id, tam);
    if (!s) return res.status(404).set("Cache-Control", "no-store").end();
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" });
    s.on("error", () => res.end());
    s.pipe(res);
  } catch (e) {
    console.error("Erro ao servir foto:", e);
    res.status(500).end();
  }
});

albumRouter.post("/:id/curtir", sem_cache, async (req, res) => {
  try {
    const leitor = leitorDe(req);
    if (!leitor) return res.status(400).json({ error: "Navegador sem identificação. Recarregue a página." });
    if (!freio(req, "curtir", 60)) return res.status(429).json({ error: "Calma! Muitas curtidas seguidas." });
    let foto = null;
    await alterar((doc) => {
      const f = doc.fotos.find((x) => x.id === String(req.params.id));
      if (!f) return doc;
      f.curtidas ||= [];
      f.curtidas = f.curtidas.includes(leitor) ? f.curtidas.filter((x) => x !== leitor) : [...f.curtidas, leitor];
      foto = f;
      return doc;
    });
    if (!foto) return res.status(404).json({ error: "Foto não encontrada." });
    res.json({ ok: true, curtidas: foto.curtidas.length, curti: foto.curtidas.includes(leitor) });
  } catch (e) {
    console.error("Erro ao curtir:", e);
    res.status(500).json({ error: "Não consegui curtir agora." });
  }
});

albumRouter.post("/:id/comentar", sem_cache, json, async (req, res) => {
  try {
    if (!freio(req, "comentar", 10)) return res.status(429).json({ error: "Muitos comentários seguidos. Aguarde um minuto." });
    const nome = limpa(req.body?.nome, NOME_MAX + 1);
    const texto = limpa(req.body?.texto, COMENTARIO_MAX + 1);
    if (nome.length < 2) return res.status(400).json({ error: "Escreva o seu nome." });
    if (nome.length > NOME_MAX) return res.status(400).json({ error: `Nome com no máximo ${NOME_MAX} caracteres.` });
    if (!texto) return res.status(400).json({ error: "Escreva o comentário." });
    if (texto.length > COMENTARIO_MAX) return res.status(400).json({ error: `Use no máximo ${COMENTARIO_MAX} caracteres.` });
    if (/https?:\/\/|www\./i.test(texto)) return res.status(400).json({ error: "Não use links no comentário." });
    const chave = crypto.randomBytes(16).toString("hex");
    const c = { id: crypto.randomUUID(), nome, texto, criadoEm: new Date().toISOString(), chave: hash(chave) };
    let achou = false;
    await alterar((doc) => {
      const f = doc.fotos.find((x) => x.id === String(req.params.id));
      if (!f) return doc;
      achou = true;
      f.comentarios = [...(f.comentarios || []), c].slice(-200);
      return doc;
    });
    if (!achou) return res.status(404).json({ error: "Foto não encontrada." });
    res.json({ ok: true, comentario: { id: c.id, nome, texto, criadoEm: c.criadoEm }, chave });
  } catch (e) {
    console.error("Erro ao comentar:", e);
    res.status(500).json({ error: "Não consegui comentar agora." });
  }
});

// Quem comentou apaga o próprio comentário (chave guardada no navegador).
albumRouter.delete("/:id/comentario/:cid", sem_cache, async (req, res) => {
  try {
    const chave = hash(req.get("x-comentario-chave") || "");
    let status = 404;
    await alterar((doc) => {
      const f = doc.fotos.find((x) => x.id === String(req.params.id));
      const c = f?.comentarios?.find((x) => x.id === String(req.params.cid));
      if (!c) return doc;
      if (!mesma(c.chave || "", chave)) return (status = 403), doc;
      status = 200;
      f.comentarios = f.comentarios.filter((x) => x.id !== c.id);
      return doc;
    });
    if (status === 404) return res.status(404).json({ error: "Comentário não encontrado." });
    if (status === 403) return res.status(403).json({ error: "Só quem escreveu pode apagar." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

// ---------------- Gestora ----------------
albumRouter.post("/gestora/fotos", sem_cache, express.json({ limit: "4400kb" }), async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const pausa = fotosPausadasAte();
  if (pausa) return res.status(423).json({ error: `Envio de fotos pausado até ${pausa.split("-").reverse().join("/")} para poupar o armazenamento.` });
  try {
    const momentoId = String(req.body?.momentoId || "");
    if (momentoId && !(await ler()).momentos.some((m) => m.id === momentoId) && !(await ler(true)).momentos.some((m) => m.id === momentoId))
      return res.status(400).json({ error: "Esse momento não existe mais. Escolha outro." });
    const grande = jpegDeDataUrl(req.body?.imagem);
    const mini = jpegDeDataUrl(req.body?.miniatura);
    if (!grande || !mini) return res.status(400).json({ error: "Imagem inválida. Use fotos JPG, PNG ou WEBP." });
    const id = crypto.randomUUID();
    await salvarImagem(id, "g", grande);
    await salvarImagem(id, "p", mini);
    const foto = {
      id,
      legenda: limpa(req.body?.legenda, LEGENDA_MAX),
      momentoId: momentoId || null,
      album: momentoId ? "" : limpa(req.body?.album, ALBUM_MAX),
      criadaEm: new Date().toISOString(),
      largura: Number(req.body?.largura) || null,
      altura: Number(req.body?.altura) || null,
      curtidas: [],
      comentarios: [],
    };
    await alterar((doc) => ((doc.fotos = [...doc.fotos, foto].slice(-400)), doc));
    res.json({ ok: true, foto: publica(foto) });
  } catch (e) {
    console.error("Erro ao publicar foto:", e);
    res.status(500).json({ error: "Não consegui publicar a foto agora." });
  }
});

albumRouter.put("/gestora/fotos/:id", sem_cache, json, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    let foto = null;
    await alterar((doc) => {
      const f = doc.fotos.find((x) => x.id === String(req.params.id));
      if (!f) return doc;
      if (req.body?.legenda !== undefined) f.legenda = limpa(req.body.legenda, LEGENDA_MAX);
      if (req.body?.momentoId !== undefined) {
        const mid = String(req.body.momentoId || "");
        if (mid && !doc.momentos.some((m) => m.id === mid)) return doc;
        f.momentoId = mid || null;
        f.album = "";
      }
      foto = f;
      return doc;
    });
    if (!foto) return res.status(404).json({ error: "Foto não encontrada." });
    res.json({ ok: true, foto: publica(foto) });
  } catch (e) {
    res.status(500).json({ error: "Não consegui salvar agora." });
  }
});

albumRouter.delete("/gestora/fotos/:id", sem_cache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    let tinha = false;
    await alterar((doc) => ((doc.fotos = doc.fotos.filter((x) => (x.id === id ? ((tinha = true), false) : true))), doc));
    if (!tinha) return res.status(404).json({ error: "Foto não encontrada." });
    await apagarImagens(id);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao apagar foto:", e);
    res.status(500).json({ error: "Não consegui apagar agora." });
  }
});

albumRouter.delete("/gestora/fotos/:id/comentario/:cid", sem_cache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    await alterar((doc) => {
      const f = doc.fotos.find((x) => x.id === String(req.params.id));
      if (f) f.comentarios = (f.comentarios || []).filter((c) => c.id !== String(req.params.cid));
      return doc;
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui remover agora." });
  }
});

// Momentos (a gestora cria antes de subir as fotos)
function dadosMomento(body) {
  const nome = limpa(body?.nome, ALBUM_MAX + 1);
  const data = String(body?.data || "");
  const descricao = limpa(body?.descricao, DESCRICAO_MAX + 1);
  if (nome.length < 2) return { erro: "Dê um nome ao momento (ex.: Confraternização de outubro)." };
  if (nome.length > ALBUM_MAX) return { erro: `Nome com no máximo ${ALBUM_MAX} caracteres.` };
  if (descricao.length > DESCRICAO_MAX) return { erro: `Descrição com no máximo ${DESCRICAO_MAX} caracteres.` };
  if (data && !DATA_RE.test(data)) return { erro: "Data inválida." };
  return { nome, data: data || hojeSP(), descricao };
}
albumRouter.post("/gestora/momentos", sem_cache, json, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const d = dadosMomento(req.body);
  if (d.erro) return res.status(400).json({ error: d.erro });
  try {
    const m = { id: crypto.randomUUID(), ...d, criadoEm: new Date().toISOString() };
    const doc = await alterar((doc) => ((doc.momentos = [...doc.momentos, m].slice(-200)), doc));
    res.json({ ok: true, momento: momentoPublico(m, doc.fotos) });
  } catch (e) {
    console.error("Erro ao criar momento:", e);
    res.status(500).json({ error: "Não consegui criar o momento agora." });
  }
});
albumRouter.put("/gestora/momentos/:id", sem_cache, json, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const d = dadosMomento(req.body);
  if (d.erro) return res.status(400).json({ error: d.erro });
  try {
    let m = null;
    const doc = await alterar((doc) => {
      m = doc.momentos.find((x) => x.id === String(req.params.id));
      if (m) Object.assign(m, d);
      return doc;
    });
    if (!m) return res.status(404).json({ error: "Momento não encontrado." });
    res.json({ ok: true, momento: momentoPublico(m, doc.fotos) });
  } catch (e) {
    res.status(500).json({ error: "Não consegui salvar agora." });
  }
});
// Remove o momento; as fotos dele continuam no álbum (em "Outras fotos").
albumRouter.delete("/gestora/momentos/:id", sem_cache, async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const id = String(req.params.id);
    let tinha = false;
    await alterar((doc) => {
      doc.momentos = doc.momentos.filter((m) => (m.id === id ? ((tinha = true), false) : true));
      for (const f of doc.fotos) if (f.momentoId === id) f.momentoId = null;
      return doc;
    });
    if (!tinha) return res.status(404).json({ error: "Momento não encontrado." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui remover agora." });
  }
});

// Resumo de um período para o Toca News: fotos novas e em quais momentos.
export async function resumoAlbum(desde, ate) {
  const doc = await ler();
  const novas = doc.fotos.filter((f) => f.criadaEm >= desde && f.criadaEm < ate);
  const nomes = Object.fromEntries(doc.momentos.map((m) => [m.id, m.nome]));
  const momentos = [...new Set(novas.map((f) => nomes[f.momentoId]).filter(Boolean))];
  const comentarios = doc.fotos.reduce((n, f) => n + (f.comentarios || []).filter((c) => c.criadoEm >= desde && c.criadoEm < ate).length, 0);
  return { fotos: novas.length, momentos, comentarios };
}

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); cache = { at: 0, doc: null }; } };
