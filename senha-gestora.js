// ======================================================
// SENHA ESCOLHIDA PELA GESTORA
//
// A gestora pode trocar a senha dela na Área da Gestora (aba "Senha").
// Guardamos só um "resumo" da senha (scrypt com sal), nunca a senha em si.
// A senha original da Vercel (SENTIMENTO_GESTORA_KEY) continua valendo como
// senha de recuperação — quem administra a Vercel consegue entrar se ela esquecer.
//
// Armazenamento: Vercel Blob em gestora/_senha.json; local data/gestora-senha.json.
// ======================================================

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerDoc, gravarDocDireto } from "./colecao.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC = "gestora/_senha.json";
const usaBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localFile = () => path.join(process.env.VERCEL ? "/tmp" : path.join(__dirname, "data"), "gestora-senha.json");

export const SENHA_MIN = 6;
export const SENHA_MAX = 64;

const TTL = 120_000;
let cache = { at: 0, doc: undefined };
const acertos = new Map(); // `${hash}|${sha256(senha)}` -> true (evita recalcular o scrypt a cada clique)

async function ler(force = false) {
  if (!force && cache.doc !== undefined && Date.now() - cache.at < TTL) return cache.doc;
  let doc = null;
  if (usaBlob()) doc = await lerDoc(DOC);
  else {
    try {
      doc = JSON.parse(await fs.readFile(localFile(), "utf8"));
    } catch {
      doc = null;
    }
  }
  doc = doc && doc.hash && doc.salt ? doc : null;
  cache = { at: Date.now(), doc };
  return doc;
}

const scrypt = (senha, salt) =>
  new Promise((ok, erro) => crypto.scrypt(String(senha), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? erro(e) : ok(k))));
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/** Informações (sem segredo) sobre a senha escolhida, ou null se ela ainda usa a original. */
export async function infoSenha() {
  const d = await ler();
  return d ? { atualizadoEm: d.atualizadoEm || null } : null;
}

/** true se `senha` é a senha que a gestora escolheu. */
export async function confereSenhaEscolhida(senha) {
  if (!senha) return false;
  const d = await ler();
  if (!d) return false;
  const chave = d.hash + "|" + sha(senha);
  if (acertos.has(chave)) return true;
  const k = await scrypt(senha, Buffer.from(d.salt, "base64"));
  const esperado = Buffer.from(d.hash, "base64");
  const ok = k.length === esperado.length && crypto.timingSafeEqual(k, esperado);
  if (ok) {
    if (acertos.size > 20) acertos.clear();
    acertos.set(chave, true);
  }
  return ok;
}

/** Valida o formato da nova senha. Devolve a mensagem de erro ou null. */
export function problemaNaSenha(nova) {
  const s = String(nova ?? "");
  if (s.trim() !== s) return "A senha não pode começar nem terminar com espaço.";
  if (s.length < SENHA_MIN) return `Use pelo menos ${SENHA_MIN} caracteres.`;
  if (s.length > SENHA_MAX) return `Use no máximo ${SENHA_MAX} caracteres.`;
  return null;
}

/** Grava a nova senha escolhida (substitui a anterior). */
export async function definirSenha(nova) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(nova, salt);
  const doc = { v: 1, salt: salt.toString("base64"), hash: hash.toString("base64"), atualizadoEm: new Date().toISOString() };
  if (usaBlob()) await gravarDocDireto(DOC, doc);
  else {
    await fs.mkdir(path.dirname(localFile()), { recursive: true });
    await fs.writeFile(localFile(), JSON.stringify(doc, null, 2));
  }
  acertos.clear();
  cache = { at: Date.now(), doc };
  return { atualizadoEm: doc.atualizadoEm };
}

export const _senha = { limpar: () => { cache = { at: 0, doc: undefined }; acertos.clear(); } };
