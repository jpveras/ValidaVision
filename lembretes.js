// ======================================================
// LEMBRETE DE SEXTA (notificação no celular/computador)
//
// Quem instala o Toca dos Bug Hunters como app (ou permite notificações no navegador) recebe,
// toda sexta de manhã, um lembrete para responder o Sentimento da Semana (e a Pergunta da
// semana, quando houver uma aberta).
//
// - Chaves de notificação (VAPID): se VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não estiverem na
//   Vercel, o servidor gera um par uma única vez e guarda no armazenamento PRIVADO
//   (lembretes/vapid.json). Ninguém precisa configurar nada.
// - Inscrições: lembretes/inscricoes.json (só o "endereço" de notificação do navegador; nada
//   de nome ou e-mail).
// - Envio: Vercel Cron chama GET /api/lembretes/enviar na sexta (ver vercel.json).
//   Proteções: só envia na sexta (horário de Brasília) e no máximo uma vez a cada 20 h;
//   se CRON_SECRET existir, exige "Authorization: Bearer <CRON_SECRET>".
//   A gestora também pode mandar um lembrete de teste pelo painel.
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { lerDoc, atualizarDoc, _colecao } from "./colecao.js";
import { exigeGestora } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_VAPID = "lembretes/vapid.json";
const DOC_INSC = "lembretes/inscricoes.json";
const TZ = "America/Sao_Paulo";

const localDir = () => (process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"));
const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

async function lerLocal(nome, padrao) {
  try {
    return JSON.parse(await fs.readFile(path.join(localDir(), nome), "utf8"));
  } catch {
    return padrao;
  }
}
async function gravarLocal(nome, data) {
  await fs.mkdir(localDir(), { recursive: true });
  await fs.writeFile(path.join(localDir(), nome), JSON.stringify(data, null, 2));
}

// ---------------- Chaves VAPID ----------------
let vapid = null;
async function chaves() {
  if (vapid) return vapid;
  const pub = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const priv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (pub && priv) vapid = { publicKey: pub, privateKey: priv };
  else if (usaBlob()) {
    vapid = await lerDoc(DOC_VAPID);
    if (!vapid?.publicKey) vapid = await atualizarDoc(DOC_VAPID, (cur) => (cur?.publicKey ? cur : webpush.generateVAPIDKeys()));
  } else {
    vapid = await lerLocal("vapid.json", null);
    if (!vapid?.publicKey) {
      vapid = webpush.generateVAPIDKeys();
      await gravarLocal("vapid.json", vapid);
    }
  }
  webpush.setVapidDetails(String(process.env.VAPID_SUBJECT || "mailto:valida-vision@example.com"), vapid.publicKey, vapid.privateKey);
  return vapid;
}

// ---------------- Inscrições ----------------
async function inscricoes() {
  if (usaBlob()) return (await lerDoc(DOC_INSC)) || { itens: [], ultimoEnvio: null };
  return lerLocal("lembretes.json", { itens: [], ultimoEnvio: null });
}
async function alterarInscricoes(fn) {
  if (usaBlob()) return atualizarDoc(DOC_INSC, (cur) => fn({ itens: [], ultimoEnvio: null, ...(cur || {}) }));
  const novo = fn(await inscricoes());
  await gravarLocal("lembretes.json", novo);
  return novo;
}

const valida = (s) =>
  s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
  typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";

function diaSemanaSP(d = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d); // "Fri"
}

async function mensagem() {
  // Se houver Pergunta da semana aberta, o lembrete menciona as duas.
  let pergunta = null;
  try {
    const doc = usaBlob() ? await lerDoc("perguntas/_dados.json") : await lerLocal("perguntas.json", null);
    pergunta = doc?.perguntas?.find((p) => !p.encerradaEm) || null;
  } catch {
    /* sem pergunta */
  }
  return {
    title: "Sexta-feira! 💚 Como foi a sua semana?",
    body: pergunta
      ? `Responda o Sentimento da Semana e a pergunta: “${pergunta.texto.slice(0, 80)}”. Leva menos de um minuto e é anônimo.`
      : "Conte em uma frase curta como foi a sua semana. Leva menos de um minuto e é anônimo.",
    url: "/sentimento.html",
    tag: "vv-sexta",
  };
}

async function enviarParaTodos() {
  await chaves();
  const { itens } = await inscricoes();
  const msg = JSON.stringify(await mensagem());
  const mortas = new Set();
  let ok = 0;
  await Promise.all(
    itens.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, msg, { TTL: 6 * 3600 });
        ok++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) mortas.add(s.endpoint);
        else console.error("Lembrete: falha ao enviar", e?.statusCode, e?.body || e?.message);
      }
    })
  );
  await alterarInscricoes((d) => ({ ...d, itens: d.itens.filter((s) => !mortas.has(s.endpoint)), ultimoEnvio: new Date().toISOString() }));
  return { enviados: ok, total: itens.length, removidas: mortas.size };
}

// ---------------- Rotas ----------------
export const lembretesRouter = express.Router();
lembretesRouter.use(express.json({ limit: "4kb" }));
lembretesRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

lembretesRouter.get("/chave", async (_req, res) => {
  try {
    res.json({ publicKey: (await chaves()).publicKey });
  } catch (e) {
    console.error("Lembrete: erro nas chaves", e);
    res.status(500).json({ error: "Lembretes indisponíveis no momento." });
  }
});

const tentativas = new Map();
lembretesRouter.post("/inscrever", async (req, res) => {
  try {
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const j = (tentativas.get(ip) || []).filter((t) => agora - t < 60_000);
    if (j.length >= 10) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    j.push(agora);
    tentativas.set(ip, j);
    const s = req.body?.subscription;
    if (!valida(s)) return res.status(400).json({ error: "Inscrição inválida." });
    await alterarInscricoes((d) => ({
      ...d,
      itens: [...d.itens.filter((x) => x.endpoint !== s.endpoint), { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, criadoEm: new Date().toISOString() }].slice(-300),
    }));
    res.json({ ok: true });
  } catch (e) {
    console.error("Lembrete: erro ao inscrever", e);
    res.status(500).json({ error: "Não consegui ativar o lembrete agora." });
  }
});

lembretesRouter.post("/cancelar", async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "");
    if (endpoint) await alterarInscricoes((d) => ({ ...d, itens: d.itens.filter((x) => x.endpoint !== endpoint) }));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Não consegui desativar agora." });
  }
});

// Chamado pelo Vercel Cron (vercel.json) na sexta de manhã.
lembretesRouter.get("/enviar", async (req, res) => {
  try {
    const segredo = String(process.env.CRON_SECRET || "").trim();
    if (segredo && req.get("authorization") !== `Bearer ${segredo}`) return res.status(401).json({ error: "Não autorizado." });
    if (!segredo && !/vercel-cron/i.test(String(req.get("user-agent") || ""))) return res.status(401).json({ error: "Não autorizado." });
    if (diaSemanaSP() !== "Fri") return res.json({ ok: true, pulado: "não é sexta" });
    const { ultimoEnvio } = await inscricoes();
    if (ultimoEnvio && Date.now() - Date.parse(ultimoEnvio) < 20 * 3600 * 1000) return res.json({ ok: true, pulado: "já enviado hoje" });
    res.json({ ok: true, ...(await enviarParaTodos()) });
  } catch (e) {
    console.error("Lembrete: erro no envio", e);
    res.status(500).json({ error: "Falha ao enviar lembretes." });
  }
});

// Painel da gestora: quantas pessoas ativaram e envio de teste.
lembretesRouter.get("/gestora", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  try {
    const d = await inscricoes();
    res.json({ inscritos: d.itens.length, ultimoEnvio: d.ultimoEnvio || null });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar os lembretes." });
  }
});
const ultimoTeste = { t: 0 };
lembretesRouter.post("/gestora/testar", async (req, res) => {
  if (!exigeGestora(req, res)) return;
  try {
    if (Date.now() - ultimoTeste.t < 5 * 60 * 1000) return res.status(429).json({ error: "Aguarde alguns minutos entre um envio e outro." });
    ultimoTeste.t = Date.now();
    res.json({ ok: true, ...(await enviarParaTodos()) });
  } catch (e) {
    console.error("Lembrete: erro no teste", e);
    res.status(500).json({ error: "Falha ao enviar." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); vapid = null; }, diaSemanaSP };
