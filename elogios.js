// ======================================================
// ELOGIE UM COLEGA
// Armazena elogios e monta a contagem de palavras da nuvem.
//
// Onde ficam os elogios:
// - Publicado na Vercel com Blob conectado (BLOB_READ_WRITE_TOKEN): Vercel Blob,
//   um único arquivo JSON (colecao.js), com gravação segura contra envios simultâneos.
// - Rodando local (npm start): arquivo data/elogios.json.
// - Na Vercel sem Blob: /tmp (temporário; a página avisa).
//
// Moderação (tela /elogios-moderacao.html, senha ELOGIOS_ADMIN_KEY):
// - Opção "Aprovar antes de mostrar": elogios novos entram como "pendente" e só aparecem
//   na nuvem/telão depois de aprovados. Desligada por padrão (tudo aparece na hora).
// ======================================================

import express from "express";
import { contarTermos, tokens } from "./palavras.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { lerDoc, atualizarDoc, gravarDocDireto, listarDocs, apagarDocs, _colecao } from "./colecao.js";
import { confereGestora, gestoraConfigurada } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "elogios/";
const NOME_MAX = 60;
const TEXTO_MAX = 280;

// Mesmo comportamento do server.js: o .env é relido a cada requisição e tem prioridade.
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
    meta: Math.max(1, Number.parseInt(e.ELOGIOS_META || "15", 10) || 15),
    adminKey: String(e.ELOGIOS_ADMIN_KEY || "").trim(),
  };
};

// ---------------- Armazenamento ----------------

function localFile() {
  const dir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "data");
  return path.join(dir, "elogios.json");
}

const fileStore = {
  kind: () => (process.env.VERCEL ? "temporario" : "arquivo-local"),
  async all() {
    try {
      return JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      return [];
    }
  },
  async save(list) {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(list, null, 2));
  },
  async add(item) {
    const list = await this.all();
    list.push(item);
    await this.save(list);
  },
  async remove(id) {
    await this.save((await this.all()).filter((e) => e.id !== id));
  },
  async clear() {
    await this.save([]);
  },
  async update(fn) {
    const list = fn(await this.all());
    await this.save(list);
    return list;
  },
};

// Vercel Blob: TODOS os elogios num único arquivo JSON (ver colecao.js).
// Leitura = 1 operação simples; escrita segura contra envios simultâneos.
const DOC = `${PREFIX}_dados.json`;
let migracaoFeita = false;

// Versões anteriores gravavam um arquivo por elogio. Se o arquivo único ainda não existe,
// importa esses arquivos antigos uma única vez (por instância) e apaga os antigos.
async function migrarLegado() {
  const antigos = (await listarDocs(PREFIX)).filter((b) => b.pathname !== DOC);
  if (!antigos.length) return null;
  const itens = [];
  for (const b of antigos) {
    try {
      const d = await lerDoc(b.pathname);
      if (d?.id) itens.push(d);
    } catch {
      /* ignora arquivo ilegível */
    }
  }
  return { itens, paths: antigos.map((b) => b.pathname) };
}

const blobStore = {
  kind: () => "vercel-blob",
  async all() {
    let d = await lerDoc(DOC);
    if (!d && !migracaoFeita) {
      migracaoFeita = true;
      const m = await migrarLegado();
      if (m?.itens.length) {
        d = await atualizarDoc(DOC, (cur) => {
          const atuais = cur?.itens || [];
          return { itens: [...atuais, ...m.itens.filter((x) => !atuais.some((y) => y.id === x.id))] };
        });
        await apagarDocs(m.paths).catch((e) => console.error("Falha ao limpar elogios antigos:", e?.message));
      }
    }
    return d?.itens || [];
  },
  async add(item) {
    return (await atualizarDoc(DOC, (cur) => ({ itens: [...(cur?.itens || []), item] }))).itens;
  },
  async remove(id) {
    return (await atualizarDoc(DOC, (cur) => ({ itens: (cur?.itens || []).filter((e) => e.id !== id) }))).itens;
  },
  async clear() {
    return (await atualizarDoc(DOC, () => ({ itens: [] }))).itens;
  },
  async update(fn) {
    return (await atualizarDoc(DOC, (cur) => ({ itens: fn(cur?.itens || []) }))).itens;
  },
};

const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

// Cache da leitura: com várias telas atualizando ao mesmo tempo (telão, celulares),
// só consultamos o armazenamento a cada READ_TTL. Depois de gravar, o cache já
// recebe a lista nova, sem nova consulta.
let readCache = { at: 0, data: null };
const READ_TTL = 15000; // o telão pede a cada 3 s; a Blob é consultada no máximo 1x a cada 15 s
const ordenar = (l) => [...l].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
async function lerTodos(force = false) {
  if (!force && readCache.data && Date.now() - readCache.at < READ_TTL) return readCache.data;
  const data = ordenar(await store().all());
  readCache = { at: Date.now(), data };
  return data;
}
async function aposGravar(itens) {
  if (Array.isArray(itens)) readCache = { at: Date.now(), data: ordenar(itens) };
  else await lerTodos(true);
}

// ---------------- Configuração da moderação ----------------
// Fica fora da "pasta" elogios/ (a migração antiga trata tudo lá dentro como elogio).
const CONFIG_DOC = "elogios-config/_config.json";
const configFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "elogios-config.json");
let configCache = { at: 0, data: null };
const CONFIG_PADRAO = { aprovarAntes: false };
async function lerConfig(force = false) {
  if (!force && configCache.data && Date.now() - configCache.at < 60_000) return configCache.data; // muda raramente
  let c = null;
  try {
    c = process.env.BLOB_READ_WRITE_TOKEN ? await lerDoc(CONFIG_DOC) : JSON.parse(await fs.readFile(configFile(), "utf8"));
  } catch {
    c = null;
  }
  const data = { ...CONFIG_PADRAO, ...(c || {}) };
  configCache = { at: Date.now(), data };
  return data;
}
async function salvarConfig(c) {
  const data = { ...CONFIG_PADRAO, ...c };
  if (process.env.BLOB_READ_WRITE_TOKEN) await gravarDocDireto(CONFIG_DOC, data);
  else {
    await fs.mkdir(path.dirname(configFile()), { recursive: true });
    await fs.writeFile(configFile(), JSON.stringify(data, null, 2));
  }
  configCache = { at: Date.now(), data };
  return data;
}

// Elogios antigos não têm status: contam como aprovados.
const pendente = (e) => e.status === "pendente";
const publico = ({ id, nome, texto, criadoEm }) => ({ id, nome, texto, criadoEm });

// ---------------- Nuvem de palavras ----------------

function contarPalavras(elogios, limite = 80) {
  // O nome do colega elogiado não entra na nuvem (senão os nomes dominam).
  return contarTermos(elogios, { limite, ignorar: (e) => new Set(tokens(e.nome).map((t) => t.toLocaleLowerCase("pt-BR"))) });
}

// ---------------- Rotas ----------------

const limpa = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const ultimoEnvio = new Map(); // ip -> horários dos envios no último minuto

const tentativas = new Map(); // ip -> { n, desde } (freio contra chutes de senha)

// Libera a moderação para quem tem a senha do moderador (ELOGIOS_ADMIN_KEY)
// ou a senha da gestora (a Área da Gestora também modera os elogios).
async function exigeAdmin(req, res) {
  const { adminKey } = conf();
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const t = tentativas.get(ip);
  if (t && Date.now() - t.desde > 10 * 60 * 1000) tentativas.delete(ip);
  if ((tentativas.get(ip)?.n || 0) >= 8) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    return false;
  }
  if (!adminKey && !(await gestoraConfigurada())) {
    res.status(403).json({ error: "Defina ELOGIOS_ADMIN_KEY no .env (ou na Vercel) para liberar esta ação." });
    return false;
  }
  const enviada = String(req.get("x-admin-key") || req.get("x-gestora-key") || "");
  let ok =
    !!adminKey &&
    enviada.length === adminKey.length &&
    crypto.timingSafeEqual(Buffer.from(enviada), Buffer.from(adminKey));
  if (!ok) ok = await confereGestora(enviada);
  if (!ok) {
    const cur = tentativas.get(ip) || { n: 0, desde: Date.now() };
    cur.n++;
    tentativas.set(ip, cur);
    res.status(401).json({ error: "Senha de moderador incorreta." });
    return false;
  }
  tentativas.delete(ip);
  return true;
}

export const elogiosRouter = express.Router();
elogiosRouter.use(express.json({ limit: "10kb" }));

// Confere a senha do moderador (usada pela tela para liberar a área do moderador).
elogiosRouter.get("/moderador", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

elogiosRouter.get("/", async (_req, res) => {
  try {
    const lista = await lerTodos();
    const todos = lista.filter((e) => !pendente(e)); // só aprovados aparecem
    const { meta } = conf();
    const { aprovarAntes } = await lerConfig();
    res.set("Cache-Control", "no-store");
    res.json({
      meta,
      total: todos.length,
      liberada: todos.length >= meta,
      aprovarAntes,
      palavras: contarPalavras(todos),
      elogios: todos.slice(-50).reverse().map(publico),
      armazenamento: store().kind(),
      adminConfigurado: !!conf().adminKey,
    });
  } catch (e) {
    console.error("Erro ao ler elogios:", e);
    res.status(500).json({ error: "Não consegui carregar os elogios agora. Tente de novo em instantes." });
  }
});

elogiosRouter.post("/", async (req, res) => {
  try {
    const nome = limpa(req.body?.nome, NOME_MAX);
    const texto = limpa(req.body?.texto, TEXTO_MAX);
    if (nome.length < 2) return res.status(400).json({ error: "Informe o nome do colega." });
    if (texto.length < 3) return res.status(400).json({ error: "Escreva o elogio." });
    // Os elogios aparecem no telão: sem links (como no Sentimento e nos comentários do álbum).
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|app|dev|me|ly)(\/|\b)/i.test(nome + " " + texto))
      return res.status(400).json({ error: "Não use links no elogio." });

    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    // Na empresa, todos saem pelo mesmo IP: o limite é por janela de 1 minuto, folgado
    // para uma sala inteira enviando junto, mas barra uma enxurrada automática.
    const janela = (ultimoEnvio.get(ip) || []).filter((t) => agora - t < 60_000);
    if (janela.length >= 40) {
      return res.status(429).json({ error: "Muitos envios em sequência. Aguarde alguns segundos e tente de novo." });
    }
    janela.push(agora);
    ultimoEnvio.set(ip, janela);
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const { aprovarAntes } = await lerConfig(true); // sempre o valor atual: o elogio não pode escapar da moderação
    const item = { id: crypto.randomUUID().slice(0, 8), nome, texto, criadoEm: new Date().toISOString() };
    if (aprovarAntes) item.status = "pendente";
    await aposGravar(await store().add(item));
    res.status(201).json({ ok: true, id: item.id, pendente: !!aprovarAntes });
  } catch (e) {
    console.error("Erro ao salvar elogio:", e);
    res.status(500).json({ error: "Não consegui salvar o elogio. Tente de novo." });
  }
});

// ---- Moderação ----
// Lista completa (inclusive pendentes) para a tela de moderação.
elogiosRouter.get("/moderacao", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    const lista = await lerTodos(true);
    const config = await lerConfig(true);
    res.set("Cache-Control", "no-store");
    res.json({
      config,
      meta: conf().meta,
      pendentes: lista.filter(pendente).reverse().map(publico),
      aprovados: lista.filter((e) => !pendente(e)).reverse().map(publico),
    });
  } catch (e) {
    console.error("Erro na moderação:", e);
    res.status(500).json({ error: "Não consegui carregar a moderação agora." });
  }
});

elogiosRouter.put("/config", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    const aprovarAntes = !!req.body?.aprovarAntes;
    const config = await salvarConfig({ aprovarAntes });
    let aprovadosAgora = 0;
    // Ao desligar a aprovação, quem estava esperando é publicado (senão ficaria escondido).
    if (!aprovarAntes) {
      const itens = await store().update((l) =>
        l.map((e) => (pendente(e) ? (aprovadosAgora++, { ...e, status: "aprovado" }) : e))
      );
      await aposGravar(itens);
    }
    res.json({ ok: true, config, aprovadosAgora });
  } catch (e) {
    console.error("Erro ao salvar configuração:", e);
    res.status(500).json({ error: "Não consegui salvar a configuração." });
  }
});

elogiosRouter.post("/aprovar-todos", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    let n = 0;
    await aposGravar(await store().update((l) => l.map((e) => (pendente(e) ? (n++, { ...e, status: "aprovado" }) : e))));
    res.json({ ok: true, aprovados: n });
  } catch (e) {
    console.error("Erro ao aprovar todos:", e);
    res.status(500).json({ error: "Não consegui aprovar os elogios." });
  }
});

elogiosRouter.post("/:id/aprovar", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    const id = String(req.params.id);
    let achou = false;
    await aposGravar(await store().update((l) => l.map((e) => (e.id === id ? ((achou = true), { ...e, status: "aprovado" }) : e))));
    if (!achou) return res.status(404).json({ error: "Esse elogio não existe mais." });
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao aprovar elogio:", e);
    res.status(500).json({ error: "Não consegui aprovar o elogio." });
  }
});

elogiosRouter.delete("/:id", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    await aposGravar(await store().remove(String(req.params.id)));
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao remover elogio:", e);
    res.status(500).json({ error: "Não consegui remover o elogio." });
  }
});

elogiosRouter.delete("/", async (req, res) => {
  if (!(await exigeAdmin(req, res))) return;
  try {
    await aposGravar(await store().clear());
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao zerar elogios:", e);
    res.status(500).json({ error: "Não consegui zerar os elogios." });
  }
});

// Usado nos testes
export const _interno = { contarPalavras, tokens, blobStore, setSdk: (m) => { _colecao.setSdk(m); migracaoFeita = false; readCache = { at: 0, data: null }; configCache = { at: 0, data: null }; } };
