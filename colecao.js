// ======================================================
// COLEÇÃO EM UM ÚNICO ARQUIVO JSON NA VERCEL BLOB
//
// Por quê: no plano gratuito, a Blob permite só 2.000 "operações avançadas" por mês
// (put, list, del, copy), mas 10.000 "simples" (get/head). Listar arquivos a cada
// atualização de tela esgotava o limite avançado em poucos dias.
//
// Como funciona:
// - Cada coleção é um arquivo JSON ({ itens: [...] }).
// - Leitura: um get (operação simples).
// - Escrita: lê, altera e grava com ifMatch (ETag). Se outra pessoa gravou no meio,
//   a Blob recusa e tentamos de novo — nenhum envio se perde.
// ======================================================

let blobSdk = null;
let blobAccess = null; // "private" ou "public", descoberto no primeiro acesso
const sdk = async () => (blobSdk ||= await import("@vercel/blob"));
const ordemAcesso = () =>
  blobAccess ? [blobAccess] : [...new Set([process.env.ELOGIOS_BLOB_ACCESS || "private", "public"])];
const erroDeAcesso = (e) => /access|private|public/i.test(String(e?.message));
const conflito = (e) =>
  e?.name === "BlobPreconditionFailedError" ||
  e?.constructor?.name === "BlobPreconditionFailedError" ||
  /precondition|already exists|etag/i.test(String(e?.message));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function lerBlob(pathname) {
  const { get } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      const r = await get(pathname, { access, useCache: false });
      blobAccess = access;
      if (!r || !r.stream) return { data: null, etag: null };
      return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob?.etag || null };
    } catch (e) {
      if (e?.name === "BlobNotFoundError" || /not.?found/i.test(String(e?.message))) return { data: null, etag: null };
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

async function gravarBlob(pathname, data, etag) {
  const { put } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      await put(pathname, JSON.stringify(data), {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      blobAccess = access;
      return;
    } catch (e) {
      ultimo = e;
      if (!erroDeAcesso(e) || conflito(e)) throw e;
    }
  }
  throw ultimo;
}

/** Lê o documento (ou null se ainda não existir). */
export async function lerDoc(pathname) {
  return (await lerBlob(pathname)).data;
}

/**
 * Altera o documento com segurança contra gravações simultâneas.
 * `fn(atual)` recebe o documento atual (ou null) e devolve o novo.
 */
export async function atualizarDoc(pathname, fn, tentativas = 8) {
  for (let i = 0; i < tentativas; i++) {
    const { data, etag } = await lerBlob(pathname);
    const novo = fn(data);
    try {
      await gravarBlob(pathname, novo, etag);
      return novo;
    } catch (e) {
      if (!conflito(e) || i === tentativas - 1) throw e;
      await espera(80 + Math.random() * 220 * (i + 1));
    }
  }
}

/**
 * Grava o documento inteiro sem conferir a versão (o último a gravar vence).
 * Para documentos com um só "dono" que podem ser substituídos sem perda (ex.: análise da semana).
 */
export async function gravarDocDireto(pathname, data) {
  const { put } = await sdk();
  let ultimo;
  for (const access of ordemAcesso()) {
    try {
      await put(pathname, JSON.stringify(data), {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        allowOverwrite: true,
      });
      blobAccess = access;
      return;
    } catch (e) {
      ultimo = e;
      if (!erroDeAcesso(e)) throw e;
    }
  }
  throw ultimo;
}

/** Lista os documentos de uma "pasta" (operação avançada: use só em telas raras). */
export async function listarDocs(prefix) {
  const { list } = await sdk();
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/** Apaga documentos (operação avançada). */
export async function apagarDocs(pathnames) {
  if (!pathnames.length) return;
  const { del } = await sdk();
  for (let i = 0; i < pathnames.length; i += 500) await del(pathnames.slice(i, i + 500));
}

// Usado nos testes
export const _colecao = { setSdk: (m) => { blobSdk = m; blobAccess = null; } };
