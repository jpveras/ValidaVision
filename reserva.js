// ======================================================
// IA RESERVA (Mistral, plano gratuito "Experiment")
//
// Entra quando o Gemini falha (sobrecarga, cota do dia esgotada, modelo indisponível)
// ou demora demais. Só é usada se MISTRAL_API_KEY estiver configurada; sem ela,
// tudo continua exatamente como antes.
//
// Variáveis (no .env ou na Vercel):
//   MISTRAL_API_KEY   chave criada em console.mistral.ai (plano gratuito, sem cartão)
//   MISTRAL_MODEL     lista em ordem, separada por vírgula (padrão abaixo)
//   MISTRAL_BASE_URL  opcional (testes)
//   RESERVA_APOS_S    segundos que o Gemini tem antes de passar para a reserva (padrão 75)
// ======================================================

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Modelos da Mistral que leem imagens (docs.mistral.ai/capabilities/vision).
const DEFAULT_MODELS = ["mistral-medium-2508", "mistral-small-2506"];

function env() {
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(readFileSync(path.join(__dirname, ".env")));
  } catch {
    /* sem .env */
  }
  return { ...process.env, ...fileEnv };
}

export function reservaConfig() {
  const e = env();
  const models = String(e.MISTRAL_MODEL || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const apiKey = String(e.MISTRAL_API_KEY || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  return {
    ativa: !!apiKey,
    apiKey,
    models: models.length ? models : DEFAULT_MODELS,
    baseUrl: String(e.MISTRAL_BASE_URL || "https://api.mistral.ai/v1").replace(/\/+$/, ""),
    aposMs: Math.max(20, Number(e.RESERVA_APOS_S) || 75) * 1000,
  };
}

// O schema do Gemini usa tipos em maiúsculas ("OBJECT"); aqui vira JSON Schema comum,
// só para descrever o formato à Mistral.
function paraJsonSchema(s) {
  if (Array.isArray(s)) return s.map(paraJsonSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : paraJsonSchema(v);
  return out;
}

export class ReservaErro extends Error {}

/**
 * Gera JSON pela Mistral. `imagem` opcional: { mime, base64 }.
 * Retorna { data, model, provider: "Mistral" }.
 */
export async function gerarNaReserva({ system, texto, schema, imagem, totalMs = 90_000, tentativaMs = 60_000 }) {
  const cfg = reservaConfig();
  if (!cfg.ativa) throw new ReservaErro("Reserva não configurada.");
  const deadline = Date.now() + totalMs;
  const instrucaoFormato =
    "\n\nFORMATO OBRIGATÓRIO: responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois), " +
    "seguindo exatamente este JSON Schema, com os mesmos nomes de campos e valores de enum:\n" +
    JSON.stringify(paraJsonSchema(schema));
  const content = imagem
    ? [
        { type: "text", text: texto },
        { type: "image_url", image_url: `data:${imagem.mime};base64,${imagem.base64}` },
      ]
    : texto;
  const body = (model) =>
    JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + instrucaoFormato },
        { role: "user", content },
      ],
    });

  let ultimo = "A IA reserva não respondeu.";
  for (const model of cfg.models) {
    const restante = deadline - Date.now();
    if (restante < 8_000) break;
    let r, data;
    try {
      r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: body(model),
        signal: AbortSignal.timeout(Math.min(tentativaMs, restante)),
      });
      data = await r.json().catch(() => ({}));
    } catch (e) {
      if (e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
      console.error(`Reserva Mistral (${model}) não respondeu a tempo.`);
      ultimo = "A IA reserva demorou demais.";
      continue;
    }
    if (!r.ok) {
      const msg = data?.message || data?.error?.message || data?.detail || `Erro ${r.status}`;
      console.error(`Reserva Mistral (${model}) erro`, r.status, typeof msg === "string" ? msg : JSON.stringify(msg));
      if (r.status === 401 || r.status === 403) throw new ReservaErro("A chave da Mistral foi recusada.");
      ultimo = r.status === 429 ? "Limite gratuito da Mistral atingido no momento." : "A IA reserva está indisponível no momento.";
      continue; // 429, 5xx, 404 ou 400 de modelo: tenta o próximo
    }
    let txt = String(data?.choices?.[0]?.message?.content || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      return { data: JSON.parse(txt), model, provider: "Mistral" };
    } catch {
      console.error(`Reserva Mistral (${model}) devolveu JSON inválido.`);
      ultimo = "A IA reserva devolveu uma resposta inválida.";
    }
  }
  throw new ReservaErro(ultimo);
}

/** Teste da chave para o Status da IA. */
export async function statusReserva() {
  const cfg = reservaConfig();
  if (!cfg.ativa) return { configurada: false, mensagem: "Sem MISTRAL_API_KEY: só o Gemini é usado." };
  try {
    const r = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { configurada: true, ok: false, provedor: "Mistral", mensagem: r.status === 401 ? "Chave da Mistral recusada." : `Erro ${r.status} da Mistral.` };
    const disp = (data.data || []).map((m) => m.id);
    return {
      configurada: true,
      ok: true,
      provedor: "Mistral",
      modelos: cfg.models,
      modelosEncontrados: cfg.models.filter((m) => disp.includes(m)),
      entraApos: `${cfg.aposMs / 1000} s de Gemini sem resposta`,
      mensagem: "Chave da Mistral válida.",
    };
  } catch (e) {
    return { configurada: true, ok: false, provedor: "Mistral", mensagem: `Não consegui falar com a Mistral: ${e?.message || e}` };
  }
}
