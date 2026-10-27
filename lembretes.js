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

// Envia uma notificação para todos os inscritos (também usada pelo Toca News).
// marcarEnvio: registra o horário como "último lembrete de sexta".
export async function enviarMensagem(msg, { marcarEnvio = false, filtro = null } = {}) {
  await chaves();
  let { itens } = await inscricoes();
  if (filtro) itens = itens.filter(filtro);
  if (!itens.length) return { enviados: 0, total: 0, removidas: 0 };
  const corpo = JSON.stringify(msg);
  const mortas = new Set();
  let ok = 0;
  await Promise.all(
    itens.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, corpo, { TTL: 6 * 3600 });
        ok++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) mortas.add(s.endpoint);
        else console.error("Notificação: falha ao enviar", e?.statusCode, e?.body || e?.message);
      }
    })
  );
  if (mortas.size || marcarEnvio)
    await alterarInscricoes((d) => ({ ...d, itens: d.itens.filter((s) => !mortas.has(s.endpoint)), ...(marcarEnvio ? { ultimoEnvio: new Date().toISOString() } : {}) }));
  return { enviados: ok, total: itens.length, removidas: mortas.size };
}

async function enviarParaTodos() {
  return enviarMensagem(await mensagem(), { marcarEnvio: true });
}

// ---------------- Aviso de elogio (v0.38) ----------------
// Quem quiser, informa o próprio nome no sino 🔔; quando chega um elogio para esse nome, só esse
// aparelho recebe "Você recebeu um elogio!". O nome fica guardado junto com a inscrição (opcional).
export const chaveNome = (n) =>
  String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// "ana" combina com "ana souza" (e vice-versa); "ana souza" não combina com "ana lima".
export function mesmoNome(a, b) {
  const x = chaveNome(a).split(" ").filter(Boolean), y = chaveNome(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  const [c, l] = x.length <= y.length ? [x, y] : [y, x];
  return c.every((t, i) => t === l[i]);
}
export async function avisarElogiados(elogios) {
  let total = 0;
  for (const e of elogios || []) {
    if (!e?.nome) continue;
    const r = await enviarMensagem(
      { title: "💚 Você recebeu um elogio!", body: `“${String(e.texto || "").slice(0, 100)}”`, url: "/elogios.html", tag: "vv-elogio-" + e.id },
      { filtro: (s) => s.nome && mesmoNome(s.nome, e.nome) }
    );
    total += r.enviados;
  }
  return total;
}
// Não deixa o envio do aviso atrasar a resposta por muito tempo.
export function avisarElogiadosRapido(elogios, ms = 4000) {
  return Promise.race([avisarElogiados(elogios).catch((e) => console.error("Aviso de elogio falhou:", e?.message || e)), new Promise((r) => setTimeout(r, ms))]);
}

// Chamadas do Vercel Cron: exige CRON_SECRET (quando existe) ou o agente do cron da Vercel.
export function cronAutorizado(req) {
  const segredo = String(process.env.CRON_SECRET || "").trim();
  if (segredo) return req.get("authorization") === `Bearer ${segredo}`;
  return /vercel-cron/i.test(String(req.get("user-agent") || ""));
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

// Liga/desliga o aviso de elogio deste aparelho (nome vazio = desliga).
lembretesRouter.post("/nome", async (req, res) => {
  try {
    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const j = (tentativas.get(ip) || []).filter((t) => agora - t < 60_000);
    if (j.length >= 10) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    j.push(agora);
    tentativas.set(ip, j);
    const endpoint = String(req.body?.endpoint || "");
    const nome = String(req.body?.nome || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!endpoint) return res.status(400).json({ error: "Ative as notificações primeiro." });
    if (nome && chaveNome(nome).length < 2) return res.status(400).json({ error: "Escreva o seu nome." });
    let achou = false;
    await alterarInscricoes((d) => ({
      ...d,
      itens: d.itens.map((x) => {
        if (x.endpoint !== endpoint) return x;
        achou = true;
        const { nome: _n, ...resto } = x;
        return nome ? { ...resto, nome } : resto;
      }),
    }));
    if (!achou) return res.status(404).json({ error: "Este aparelho não está com as notificações ativas. Ative de novo pelo sino 🔔." });
    res.json({ ok: true, nome: nome || null });
  } catch (e) {
    console.error("Lembrete: erro ao salvar nome", e);
    res.status(500).json({ error: "Não consegui salvar agora." });
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
    if (!cronAutorizado(req)) return res.status(401).json({ error: "Não autorizado." });
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
  if (!(await exigeGestora(req, res))) return;
  try {
    const d = await inscricoes();
    res.json({ inscritos: d.itens.length, avisoElogio: d.itens.filter((x) => x.nome).length, ultimoEnvio: d.ultimoEnvio || null });
  } catch (e) {
    res.status(500).json({ error: "Não consegui carregar os lembretes." });
  }
});
const ultimoTeste = { t: 0 };
lembretesRouter.post("/gestora/testar", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    if (Date.now() - ultimoTeste.t < 5 * 60 * 1000) return res.status(429).json({ error: "Aguarde alguns minutos entre um envio e outro." });
    ultimoTeste.t = Date.now();
    res.json({ ok: true, ...(await enviarParaTodos()) });
  } catch (e) {
    console.error("Lembrete: erro no teste", e);
    res.status(500).json({ error: "Falha ao enviar." });
  }
});

export { diaSemanaSP };
// Aviso livre da gestora para todos que ativaram as notificações (ex.: "Atualize o app").
const ultimoAviso = { t: 0 };
lembretesRouter.post("/gestora/aviso", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  try {
    const linha = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    const title = linha(req.body?.titulo, 60), body = linha(req.body?.texto, 180);
    let url = String(req.body?.link || "").trim() || "/inicio.html";
    if (!/^\/[^/]/.test(url) && url !== "/") return res.status(400).json({ error: "O link precisa ser uma página da Toca (começando com /)." });
    if (title.length < 3 || body.length < 3) return res.status(400).json({ error: "Escreva o título e o texto do aviso." });
    if (Date.now() - ultimoAviso.t < 5 * 60 * 1000) return res.status(429).json({ error: "Aguarde alguns minutos entre um aviso e outro." });
    ultimoAviso.t = Date.now();
    res.json({ ok: true, ...(await enviarMensagem({ title, body, url: url.slice(0, 200), tag: "vv-aviso-" + Date.now() })) });
  } catch (e) {
    console.error("Aviso da gestora: erro", e);
    res.status(500).json({ error: "Falha ao enviar o aviso." });
  }
});

export const _interno = { setSdk: (m) => { _colecao.setSdk(m); vapid = null; }, diaSemanaSP };
