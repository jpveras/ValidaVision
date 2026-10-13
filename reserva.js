// ======================================================
// IA RESERVA
//
// Entra quando o Gemini falha (sobrecarga, cota do dia esgotada, modelo indisponível)
// ou demora demais. Sem nenhuma chave de reserva, tudo continua exatamente como antes.
//
// Provedores (usa o primeiro configurado):
//  1) Cloudflare Workers AI — plano gratuito com 10.000 "Neurons"/dia, sem cartão.
//       CLOUDFLARE_API_TOKEN   token com permissão Workers AI
//       CLOUDFLARE_ACCOUNT_ID  ID da conta (padrão: a conta do projeto)
//       CLOUDFLARE_MODEL       lista em ordem (padrão abaixo; precisa ler imagens)
//  2) Mistral — só com plano pago (o gratuito não libera a API).
//       MISTRAL_API_KEY, MISTRAL_MODEL
//
//   RESERVA_APOS_S  segundos que o Gemini tem antes de passar para a reserva (padrão 75)
//   RESERVA_BASE_URL  opcional (testes)
// ======================================================

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Modelos que leem imagens (developers.cloudflare.com/workers-ai/models e docs.mistral.ai/capabilities/vision).
const CF_MODELS = ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct"];
const MISTRAL_MODELS = ["mistral-medium-2508", "mistral-small-2506"];
const CF_ACCOUNT_PADRAO = "b3cc5e4502af4e4d71ea25c711a6fe0d"; // ID da conta não é segredo

function env() {
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(readFileSync(path.join(__dirname, ".env")));
  } catch {
    /* sem .env */
  }
  return { ...process.env, ...fileEnv };
}

const limpa = (v) =>
  String(v || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
const lista = (v, padrao) => {
  const l = String(v || "").split(",").map((m) => m.trim()).filter(Boolean);
  return l.length ? l : padrao;
};

export function reservaConfig() {
  const e = env();
  const aposMs = Math.max(20, Number(e.RESERVA_APOS_S) || 75) * 1000;
  const cfToken = limpa(e.CLOUDFLARE_API_TOKEN);
  if (cfToken) {
    const conta = limpa(e.CLOUDFLARE_ACCOUNT_ID) || CF_ACCOUNT_PADRAO;
    return {
      ativa: true,
      provedor: "Cloudflare",
      apiKey: cfToken,
      conta,
      models: lista(e.CLOUDFLARE_MODEL, CF_MODELS),
      baseUrl: String(e.RESERVA_BASE_URL || `https://api.cloudflare.com/client/v4/accounts/${conta}/ai/v1`).replace(/\/+$/, ""),
      aposMs,
    };
  }
  const mKey = limpa(e.MISTRAL_API_KEY);
  return {
    ativa: !!mKey,
    provedor: "Mistral",
    apiKey: mKey,
    models: lista(e.MISTRAL_MODEL, MISTRAL_MODELS),
    baseUrl: String(e.RESERVA_BASE_URL || e.MISTRAL_BASE_URL || "https://api.mistral.ai/v1").replace(/\/+$/, ""),
    aposMs,
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
  const dataUrl = imagem ? `data:${imagem.mime};base64,${imagem.base64}` : null;
  const content = imagem
    ? [
        { type: "text", text: texto },
        { type: "image_url", image_url: cfg.provedor === "Cloudflare" ? { url: dataUrl } : dataUrl },
      ]
    : texto;
  const body = (model, comFormato) =>
    JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 8000,
      ...(comFormato ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system + instrucaoFormato },
        { role: "user", content },
      ],
    });

  const nome = cfg.provedor;
  let ultimo = "A IA reserva não respondeu.";
  for (const model of cfg.models) {
    // Primeiro com "JSON mode"; se o modelo não aceitar esse parâmetro, de novo sem ele.
    for (const comFormato of [true, false]) {
      const restante = deadline - Date.now();
      if (restante < 8_000) break;
      let r, data;
      try {
        r = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: body(model, comFormato),
          signal: AbortSignal.timeout(Math.min(tentativaMs, restante)),
        });
        data = await r.json().catch(() => ({}));
      } catch (e) {
        if (e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
        console.error(`Reserva ${nome} (${model}) não respondeu a tempo.`);
        ultimo = "A IA reserva demorou demais.";
        break;
      }
      if (!r.ok) {
        const msg = erroTexto(data) || `Erro ${r.status}`;
        console.error(`Reserva ${nome} (${model}${comFormato ? "" : ", sem JSON mode"}) erro`, r.status, msg);
        if (r.status === 401 || r.status === 403) throw new ReservaErro(`A chave da ${nome} foi recusada.`);
        if (r.status === 400 && comFormato && /response_format|json/i.test(msg)) continue; // tenta sem JSON mode
        ultimo = r.status === 429 ? `Limite gratuito da ${nome} atingido no momento.` : `A IA reserva (${nome}) está indisponível no momento.`;
        break; // 429, 5xx, 404: próximo modelo
      }
      const bruto = data?.choices?.[0]?.message?.content ?? data?.result?.response ?? "";
      if (bruto && typeof bruto === "object") return { data: bruto, model, provider: nome };
      const json = extraiJSON(String(bruto));
      if (json) return { data: json, model, provider: nome };
      console.error(`Reserva ${nome} (${model}) devolveu JSON inválido:`, String(bruto).slice(0, 300));
      ultimo = "A IA reserva devolveu uma resposta inválida.";
      if (comFormato) continue; // às vezes sai melhor sem JSON mode
    }
  }
  throw new ReservaErro(ultimo);
}

function erroTexto(data) {
  const m = data?.message || data?.error?.message || data?.errors?.[0]?.message || data?.detail || data?.error;
  return typeof m === "string" ? m : m ? JSON.stringify(m) : "";
}

// Aceita JSON puro, com cercas de markdown ou com texto em volta.
function extraiJSON(txt) {
  const t = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf("{");
    const f = t.lastIndexOf("}");
    if (i >= 0 && f > i) {
      try {
        return JSON.parse(t.slice(i, f + 1));
      } catch {
        /* inválido */
      }
    }
  }
  return null;
}

/** Teste da chave para o Status da IA. */
export async function statusReserva() {
  const cfg = reservaConfig();
  if (!cfg.ativa) return { configurada: false, mensagem: "Sem chave de IA reserva: só o Gemini é usado." };
  const base = { configurada: true, provedor: cfg.provedor, modelos: cfg.models, entraApos: `${cfg.aposMs / 1000} s de Gemini sem resposta` };
  try {
    const url =
      cfg.provedor === "Cloudflare"
        ? `https://api.cloudflare.com/client/v4/accounts/${cfg.conta}/ai/models/search?per_page=200`
        : `${cfg.baseUrl}/models`;
    const r = await fetch(process.env.RESERVA_STATUS_URL || url, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ...base, ok: false, mensagem: r.status === 401 || r.status === 403 ? `Chave da ${cfg.provedor} recusada.` : `Erro ${r.status} da ${cfg.provedor}: ${erroTexto(data)}` };
    }
    const disp = (data.result || data.data || []).map((m) => m.name || m.id);
    return { ...base, ok: true, modelosEncontrados: cfg.models.filter((m) => disp.includes(m)), mensagem: `Chave da ${cfg.provedor} válida.` };
  } catch (e) {
    return { ...base, ok: false, mensagem: `Não consegui falar com a ${cfg.provedor}: ${e?.message || e}` };
  }
}
