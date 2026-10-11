// ======================================================
// ELOGIE UM COLEGA
// Armazena elogios e monta a contagem de palavras da nuvem.
//
// Onde ficam os elogios:
// - Publicado na Vercel com Blob conectado (BLOB_READ_WRITE_TOKEN): Vercel Blob,
//   um arquivo por elogio (envios simultâneos não se sobrescrevem).
// - Rodando local (npm start): arquivo data/elogios.json.
// - Na Vercel sem Blob: /tmp (temporário; a página avisa).
// ======================================================

import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

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
    meta: Math.max(1, Number.parseInt(e.ELOGIOS_META || "10", 10) || 10),
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
};

let blobSdk = null;
let blobAccess = null; // descoberto na primeira escrita/leitura: "private" ou "public"
const blobCache = new Map(); // pathname -> elogio (elogios não mudam depois de criados)

async function sdk() {
  blobSdk ||= await import("@vercel/blob");
  return blobSdk;
}

const blobStore = {
  kind: () => "vercel-blob",
  async all() {
    const { list, get } = await sdk();
    const blobs = [];
    let cursor;
    do {
      const r = await list({ prefix: PREFIX, limit: 1000, cursor });
      blobs.push(...r.blobs);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);

    const vivos = new Set(blobs.map((b) => b.pathname));
    for (const k of blobCache.keys()) if (!vivos.has(k)) blobCache.delete(k);

    const faltando = blobs.filter((b) => !blobCache.has(b.pathname));
    await Promise.all(
      faltando.map(async (b) => {
        try {
          const order = blobAccess ? [blobAccess] : [process.env.ELOGIOS_BLOB_ACCESS || "private", "public"];
          for (const access of [...new Set(order)]) {
            try {
              const r = await get(b.pathname, { access, useCache: false });
              if (!r) return;
              const txt = await new Response(r.stream).text();
              blobAccess = access;
              blobCache.set(b.pathname, { ...JSON.parse(txt), _path: b.pathname });
              return;
            } catch (e) {
              if (!/access|private|public/i.test(String(e?.message))) throw e;
            }
          }
        } catch (e) {
          console.error("Elogio ilegível:", b.pathname, e?.message);
        }
      })
    );
    return [...blobCache.values()];
  },
  async add(item) {
    const { put } = await sdk();
    const pathname = `${PREFIX}${item.criadoEm.replace(/[:.]/g, "-")}-${item.id}.json`;
    const order = blobAccess ? [blobAccess] : [process.env.ELOGIOS_BLOB_ACCESS || "private", "public"];
    let lastErr;
    for (const access of [...new Set(order)]) {
      try {
        await put(pathname, JSON.stringify(item), {
          access,
          contentType: "application/json",
          addRandomSuffix: false,
        });
        blobAccess = access;
        blobCache.set(pathname, { ...item, _path: pathname });
        return;
      } catch (e) {
        lastErr = e;
        if (!/access|private|public/i.test(String(e?.message))) throw e;
      }
    }
    throw lastErr;
  },
  async remove(id) {
    const { del } = await sdk();
    const alvo = (await this.all()).find((e) => e.id === id);
    if (alvo) {
      await del(alvo._path);
      blobCache.delete(alvo._path);
    }
  },
  async clear() {
    const { del } = await sdk();
    const paths = (await this.all()).map((e) => e._path);
    for (let i = 0; i < paths.length; i += 500) await del(paths.slice(i, i + 500));
    blobCache.clear();
  },
};

const store = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore);

// Cache curto da leitura: com várias pessoas atualizando a tela, evita
// listar o armazenamento a cada requisição.
let readCache = { at: 0, data: null };
const READ_TTL = 3000;
async function lerTodos(force = false) {
  if (!force && readCache.data && Date.now() - readCache.at < READ_TTL) return readCache.data;
  const data = (await store().all()).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  readCache = { at: Date.now(), data };
  return data;
}
const invalidar = () => (readCache = { at: 0, data: null });

// ---------------- Nuvem de palavras ----------------

const STOP = new Set(
  `a à às ao aos as o os um uma uns umas de da das do dos d em na nas no nos num numa por pela pelas pelo pelos para pra pro pras pros com sem sob sobre entre até após ante contra desde
  e é eh ou mas mais menos que quem qual quais quando onde como porque porquê pois se já não nao sim só so também tambem muito muita muitos muitas pouco pouca bem mal
  eu tu ele ela nós nos vós eles elas você voce vocês voces me te se lhe lhes meu minha meus minhas teu tua seu sua seus suas nosso nossa nossos nossas dele dela deles delas
  isso isto aquilo esse essa esses essas este esta estes estas aquele aquela aqueles aquelas aqui ali lá la cá ca aí ai
  ser sou és é somos são foi fui foram era eram será serão seja sejam sendo sido estar estou está estamos estão esteve estava estavam
  ter tenho tem temos têm tinha tinham teve tido haver há havia faz fazer fez feito vai vou vamos ir sempre nunca todo toda todos todas tudo nada algo alguém ninguém
  cada outro outra outros outras mesmo mesma tão tao tanto tanta ainda agora hoje dia vez vezes coisa coisas pessoa pessoas obrigado obrigada valeu
  the and you are`.split(/\s+/).filter(Boolean)
);

function tokens(txt) {
  return (String(txt || "").match(/[\p{L}\p{N}]+(?:[-'][\p{L}]+)*/gu) || []);
}

function contarPalavras(elogios, limite = 80) {
  const cont = new Map(); // palavra em minúsculas -> quantidade
  for (const e of elogios) {
    // O nome do colega elogiado não entra na nuvem (senão os nomes dominam).
    const doNome = new Set(tokens(e.nome).map((t) => t.toLocaleLowerCase("pt-BR")));
    for (const t of tokens(e.texto)) {
      const k = t.toLocaleLowerCase("pt-BR");
      if (k.length < 3 || STOP.has(k) || doNome.has(k) || /^\d+$/.test(k)) continue;
      cont.set(k, (cont.get(k) || 0) + 1);
    }
  }
  return [...cont.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, limite);
}

// ---------------- Rotas ----------------

const limpa = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const ultimoEnvio = new Map(); // ip -> timestamp (freio simples contra cliques repetidos)

const tentativas = new Map(); // ip -> { n, desde } (freio contra chutes de senha)

function exigeAdmin(req, res) {
  const { adminKey } = conf();
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const t = tentativas.get(ip);
  if (t && Date.now() - t.desde > 10 * 60 * 1000) tentativas.delete(ip);
  if ((tentativas.get(ip)?.n || 0) >= 8) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    return false;
  }
  if (!adminKey) {
    res.status(403).json({ error: "Defina ELOGIOS_ADMIN_KEY no .env (ou na Vercel) para liberar esta ação." });
    return false;
  }
  const enviada = String(req.get("x-admin-key") || "");
  const ok =
    enviada.length === adminKey.length &&
    crypto.timingSafeEqual(Buffer.from(enviada), Buffer.from(adminKey));
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
elogiosRouter.get("/moderador", (req, res) => {
  if (!exigeAdmin(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

elogiosRouter.get("/", async (_req, res) => {
  try {
    const todos = await lerTodos();
    const { meta } = conf();
    res.set("Cache-Control", "no-store");
    res.json({
      meta,
      total: todos.length,
      liberada: todos.length >= meta,
      palavras: contarPalavras(todos),
      elogios: todos
        .slice(-50)
        .reverse()
        .map(({ id, nome, texto, criadoEm }) => ({ id, nome, texto, criadoEm })),
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

    const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    if (agora - (ultimoEnvio.get(ip) || 0) < 3000) {
      return res.status(429).json({ error: "Calma! Aguarde alguns segundos para enviar outro elogio." });
    }
    ultimoEnvio.set(ip, agora);
    if (ultimoEnvio.size > 5000) ultimoEnvio.clear();

    const item = { id: crypto.randomUUID().slice(0, 8), nome, texto, criadoEm: new Date().toISOString() };
    await store().add(item);
    invalidar();
    res.status(201).json({ ok: true, id: item.id });
  } catch (e) {
    console.error("Erro ao salvar elogio:", e);
    res.status(500).json({ error: "Não consegui salvar o elogio. Tente de novo." });
  }
});

elogiosRouter.delete("/:id", async (req, res) => {
  if (!exigeAdmin(req, res)) return;
  try {
    await store().remove(String(req.params.id));
    invalidar();
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao remover elogio:", e);
    res.status(500).json({ error: "Não consegui remover o elogio." });
  }
});

elogiosRouter.delete("/", async (req, res) => {
  if (!exigeAdmin(req, res)) return;
  try {
    await store().clear();
    invalidar();
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao zerar elogios:", e);
    res.status(500).json({ error: "Não consegui zerar os elogios." });
  }
});

// Usado nos testes
export const _interno = { contarPalavras, tokens, blobStore, setSdk: (m) => { blobSdk = m; blobAccess = null; blobCache.clear(); } };
