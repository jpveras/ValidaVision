// ======================================================
// IA (Gemini) PARA RECURSOS ALÉM DA ANÁLISE DE TELA
// Módulo separado do server.js para não mexer na Análise de Tela.
// Mesma configuração: GEMINI_API_KEY, GEMINI_MODEL (lista com reserva),
// GEMINI_BASE_URL e DEMO_MODE, lidos do .env (prioridade) ou do ambiente.
// ======================================================

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.7-flash"];

export function iaConfig() {
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(readFileSync(path.join(__dirname, ".env")));
  } catch {
    /* sem .env */
  }
  const env = { ...process.env, ...fileEnv };
  const models = String(env.GEMINI_MODEL || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    apiKey: String(env.GEMINI_API_KEY || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, ""),
    models: models.length ? models : DEFAULT_MODELS,
    demoMode: String(env.DEMO_MODE || "false").toLowerCase() === "true",
    baseUrl: String(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, ""),
  };
}

async function chamar(cfg, model, payload, signal) {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal };
  let response = await fetch(url, { ...opts, headers: { ...opts.headers, "x-goog-api-key": cfg.apiKey } });
  let data = await response.json().catch(() => ({}));
  if (response.status === 401 && data?.error?.details?.[0]?.reason === "ACCESS_TOKEN_TYPE_UNSUPPORTED") {
    response = await fetch(`${url}?key=${encodeURIComponent(cfg.apiKey)}`, opts);
    data = await response.json().catch(() => ({}));
  }
  return { response, data };
}

export class IAErro extends Error {
  constructor(msg, status = 502) {
    super(msg);
    this.status = status;
  }
}

/**
 * Gera uma resposta JSON seguindo `schema`. Tenta os modelos de GEMINI_MODEL em ordem:
 * modelo lento/sobrecarregado/inexistente → próximo. Cada tentativa tem tempo máximo.
 * Retorna { data, model }.
 */
export async function gerarJSON({ system, texto, schema, temperatura = 0.4, tentativaMs, totalMs }) {
  const cfg = iaConfig();
  if (!cfg.apiKey || cfg.apiKey.includes("COLOQUE_SUA_CHAVE")) {
    throw new IAErro("GEMINI_API_KEY não configurada.", 500);
  }
  const ATTEMPT_MS = tentativaMs || Number(process.env.GEMINI_ATTEMPT_MS) || 60_000;
  const deadline = Date.now() + (totalMs || Number(process.env.GEMINI_TOTAL_MS) || 120_000);
  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: texto }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: temperatura },
  };

  let ultimo = "A IA não respondeu.";
  for (const model of cfg.models) {
    const restante = deadline - Date.now();
    if (restante < Math.min(10_000, ATTEMPT_MS / 2)) break;
    let response, data;
    try {
      ({ response, data } = await chamar(cfg, model, payload, AbortSignal.timeout(Math.min(ATTEMPT_MS, restante))));
    } catch (e) {
      if (e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
      console.error(`IA (${model}) não respondeu a tempo.`);
      ultimo = "A IA está demorando mais que o normal. Tente de novo em instantes.";
      continue;
    }
    if (!response.ok) {
      console.error(`IA (${model}) erro`, response.status, data?.error?.message);
      ultimo = data?.error?.message || `Erro ${response.status} da IA.`;
      if ([404, 429, 500, 503, 504].includes(response.status)) continue;
      throw new IAErro(response.status === 403 || response.status === 401 ? "A chave do Gemini foi recusada." : ultimo);
    }
    const txt = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    try {
      return { data: JSON.parse(txt), model };
    } catch {
      ultimo = "A IA devolveu uma resposta inválida.";
      continue;
    }
  }
  throw new IAErro(ultimo, 504);
}
