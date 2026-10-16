import { modeloIndisponivel, cotaEsgotada, marcarCota } from "./ia.js";
import { reservaConfig, gerarNaReserva, statusReserva } from "./reserva.js";
import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elogiosRouter } from "./elogios.js";
import { sentimentosRouter } from "./sentimentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");

const app = express();


// ======================================================
// CONFIGURAÇÃO (RELIDA DO .env A CADA REQUISIÇÃO)
// Para trocar a chave: edite o .env e salve. Não precisa reiniciar.
// O valor do .env tem prioridade sobre variáveis do Windows.
// ======================================================

const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

function cleanKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/^GEMINI_API_KEY\s*=\s*/i, "")
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

function maskKey(key) {
  if (!key) return "(vazia)";
  if (key.length <= 10) return "***";
  return `${key.slice(0, 4)}…${key.slice(-3)} (${key.length} caracteres)`;
}

function getConfig() {
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(fs.readFileSync(ENV_PATH));
  } catch {
    // sem .env: usa só as variáveis do sistema
  }

  const env = { ...process.env, ...fileEnv };

  const models = String(env.GEMINI_MODEL || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return {
    apiKey: cleanKey(env.GEMINI_API_KEY),
    models: models.length ? models : DEFAULT_MODELS,
    demoMode: String(env.DEMO_MODE || "false").toLowerCase() === "true",
    port: Number(env.PORT || 3000),
    baseUrl: String(
      env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, ""),
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Formato não suportado. Use PNG, JPG/JPEG ou WEBP."));
    }
    cb(null, true);
  },
});

// Análise de Tela OCULTA (16/10/2026): na empresa já existe uma frente sobre isso.
// A tela continua no projeto (public/analise.html) e a API /api/analyze segue funcionando;
// só sai do menu e deixa de ser a página inicial. Para voltar a mostrar:
//   1) defina ANALISE_TELA_VISIVEL=true (na Vercel ou no .env) — a página inicial volta a ser a análise;
//   2) apague a regra [data-recurso="analise"] no fim de public/vv-tema.css — o item volta ao menu.
const analiseVisivel = () => /^(1|true|sim)$/i.test(String(process.env.ANALISE_TELA_VISIVEL || "").trim());
app.get(["/", "/index.html"], (_req, res) => res.redirect(302, analiseVisivel() ? "/analise.html" : "/elogios.html"));

app.use(express.static(path.join(__dirname, "public")));

// Elogie um Colega (rotas próprias, não interferem na análise de tela)
app.use("/api/elogios", elogiosRouter);

// Links curtos para o público (caso o QR Code não funcione)
app.get(["/elogie", "/e"], (_req, res) => res.redirect(302, "/elogiar.html"));
app.get(["/moderar", "/moderacao"], (_req, res) => res.redirect(302, "/elogios-moderacao.html"));

// Sentimento da Semana (rotas próprias)
app.use("/api/sentimentos", sentimentosRouter);


// ======================================================
// PROMPT DO VALIDAI VISION
// ======================================================

const systemPrompt = `
Você é o Valida Vision, um assistente especialista em QA e testes de interfaces.

Sua tarefa é analisar a captura de tela enviada pelo usuário e transformar APENAS
os elementos visualmente identificáveis em sugestões de testes.

REGRAS:

- Analise somente o que estiver visível na imagem.
- Não invente regras de negócio que não estejam evidentes.
- Identifique componentes como campos, botões, selects, checkboxes, rádios,
  links, tabelas, menus, paginação e mensagens.
- Diferencie componente identificado de cenário sugerido.
- Considere, quando fizer sentido:
  obrigatoriedade,
  formato,
  limites,
  valores inválidos,
  estados,
  mensagens,
  navegação,
  tabelas,
  paginação,
  ações repetidas
  e estados vazios.
- Não diga que um teste foi executado.
- Você somente sugere testes para o QA executar.
- Quando não houver evidência suficiente, use confiança baixa
  e explique o motivo.
- Priorize os cenários mais importantes para cobertura funcional.
- Gere cenários claros, objetivos e executáveis por um QA.
- Para cada componente, preencha "observations": fatos que você VIU na imagem
  (ex.: "Campo CPF com máscara 000.000.000-00", "Botão desabilitado", "Asterisco
  indicando obrigatoriedade"). Observações descrevem o que está visível, nunca
  o que você supõe.
- Em cada cenário, o campo "rationale" deve explicar de onde veio a sugestão,
  citando a observação ou o tipo de componente que a motivou. Nunca sugira um
  teste sem ligação clara com algo visível ou com o comportamento típico do
  componente.
- Prioridade: "alta" = risco de dados inválidos, bloqueio do fluxo principal ou
  falha de validação; "media" = comportamento secundário ou repetição de ações;
  "baixa" = navegação e aspectos cosméticos. Não marque tudo como alta.
- Em "notCovered", liste de 3 a 8 itens que um QA costuma esquecer e que NÃO
  estão entre os cenários gerados (ex.: limite máximo de caracteres, campo
  obrigatório sem preenchimento, mensagem de erro, atualização da página
  durante o preenchimento, duplo clique, permissão de usuário, estado vazio,
  sessão expirada). Cada item deve ter um motivo curto e uma prioridade.
  Não repita cenários já listados em testPoints.
- Responda SOMENTE com o JSON solicitado.
`;



// ======================================================
// FORMATO DE RESPOSTA DA IA
// ======================================================

const responseSchema = {
  type: "OBJECT",

  properties: {
    summary: {
      type: "STRING",
    },

    confidence: {
      type: "STRING",
      enum: ["alta", "media", "baixa"],
    },

    components: {
      type: "ARRAY",

      items: {
        type: "OBJECT",

        properties: {
          name: {
            type: "STRING",
          },

          type: {
            type: "STRING",

            enum: [
              "input",
              "button",
              "select",
              "checkbox",
              "radio",
              "link",
              "table",
              "menu",
              "pagination",
              "message",
              "other",
            ],
          },

          location: {
            type: "STRING",
          },

          observations: {
            type: "ARRAY",
            items: { type: "STRING" },
          },

          confidence: {
            type: "STRING",
            enum: ["alta", "media", "baixa"],
          },

          testPoints: {
            type: "ARRAY",

            items: {
              type: "OBJECT",

              properties: {
                title: {
                  type: "STRING",
                },

                category: {
                  type: "STRING",

                  enum: [
                    "funcional",
                    "validacao",
                    "navegacao",
                    "erro",
                    "usabilidade",
                    "limite",
                    "seguranca",
                  ],
                },

                priority: {
                  type: "STRING",
                  enum: ["alta", "media", "baixa"],
                },

                steps: {
                  type: "ARRAY",

                  items: {
                    type: "STRING",
                  },
                },

                expected: {
                  type: "STRING",
                },

                rationale: {
                  type: "STRING",
                },
              },

              required: [
                "title",
                "category",
                "priority",
                "steps",
                "expected",
                "rationale",
              ],
            },
          },
        },

        required: [
          "name",
          "type",
          "location",
          "confidence",
          "observations",
          "testPoints",
        ],
      },
    },

    // "O que estou esquecendo?": pontos que um QA costuma esquecer e que não estão nos cenários.
    notCovered: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          reason: { type: "STRING" },
          priority: { type: "STRING", enum: ["alta", "media", "baixa"] },
        },
        required: ["title", "reason", "priority"],
      },
    },
  },

  required: [
    "summary",
    "confidence",
    "components",
    "notCovered",
  ],
};


// ======================================================
// CHAMADAS À GEMINI + DIAGNÓSTICO DE ERROS
// ======================================================

async function geminiFetch(cfg, urlPath, options = {}) {
  const url = `${cfg.baseUrl}${urlPath}`;

  const doFetch = (finalUrl) =>
    fetch(finalUrl, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "x-goog-api-key": cfg.apiKey,
      },
    });

  let response = await doFetch(url);
  let data = await response.json().catch(() => ({}));

  // Plano B: alguns clientes só aceitam a chave via ?key=
  const reason = data?.error?.details?.[0]?.reason;
  if (response.status === 401 && reason === "ACCESS_TOKEN_TYPE_UNSUPPORTED") {
    const sep = url.includes("?") ? "&" : "?";
    const retry = await fetch(
      `${url}${sep}key=${encodeURIComponent(cfg.apiKey)}`,
      { ...options, headers: { ...(options.headers || {}) } }
    );
    const retryData = await retry.json().catch(() => ({}));
    if (retry.ok) {
      response = retry;
      data = retryData;
    }
  }

  return { response, data };
}

function explainError(status, data, cfg) {
  const msg = data?.error?.message || "";
  const reason = data?.error?.details?.[0]?.reason || "";
  const key = maskKey(cfg.apiKey);

  if (reason === "ACCESS_TOKEN_TYPE_UNSUPPORTED" || status === 401) {
    return (
      `O Google recusou a chave (${key}). ` +
      "Gere uma chave NOVA em aistudio.google.com/apikey, cole no .env em GEMINI_API_KEY " +
      "(sem aspas e sem espaços) e salve. Não precisa reiniciar o servidor."
    );
  }
  if (status === 403) {
    return (
      `A chave (${key}) não tem permissão para a Gemini API. ` +
      "Confira se a Generative Language API está ativa no projeto da chave."
    );
  }
  if (status === 429) {
    return (
      "A cota gratuita do Gemini para esta chave acabou por hoje (o plano gratuito do Google " +
      "tem um limite diário de pedidos). Tente mais tarde ou ative o faturamento da chave no Google AI Studio."
    );
  }
  if (status === 503 || status === 500 || status === 504) {
    return (
      "A Gemini está sobrecarregada no momento (alta demanda). Já tentei novamente e " +
      "troquei de modelo, sem sucesso. Aguarde alguns minutos e tente de novo, ou " +
      "adicione outro modelo em GEMINI_MODEL no .env (separado por vírgula)."
    );
  }
  if (status === 404) {
    return `Modelo não encontrado: ${msg || "verifique GEMINI_MODEL no .env"}`;
  }
  return msg || "A Gemini API recusou a requisição.";
}

// ======================================================
// TESTE DA CHAVE (usado pela tela e por você no navegador)
// Abra http://localhost:3000/api/health
// ======================================================

app.get("/api/health", async (_req, res) => {
  const cfg = getConfig();

  if (cfg.demoMode) {
    return res.json({ ok: true, demo: true, message: "Modo demonstração ativo." });
  }
  if (!cfg.apiKey || cfg.apiKey.includes("COLOQUE_SUA_CHAVE")) {
    return res.status(500).json({
      ok: false,
      message: "GEMINI_API_KEY não configurada. Cole sua chave no arquivo .env.",
    });
  }

  try {
    const { response, data } = await geminiFetch(cfg, "/models?pageSize=200", {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        key: maskKey(cfg.apiKey),
        message: explainError(response.status, data, cfg),
      });
    }

    const available = (data.models || []).map((m) => m.name.replace(/^models\//, ""));
    const found = cfg.models.filter((m) => available.includes(m));
    // Outros modelos que a chave pode usar como reserva em GEMINI_MODEL (só os que geram texto).
    const alternatives = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /gemini/i.test(n) && /flash|pro/i.test(n) && !/tts|audio|image|live|embedding/i.test(n))
      .filter((n) => !cfg.models.includes(n));

    return res.json({
      ok: true,
      key: maskKey(cfg.apiKey),
      models: cfg.models,
      modelsFound: found,
      alternatives,
      reserva: await statusReserva(),
      message: found.length
        ? "Chave válida."
        : "Chave válida, mas nenhum modelo de GEMINI_MODEL foi encontrado. Ajuste o .env.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: `Não consegui falar com o Google: ${error?.message || error}`,
    });
  }
});



// ======================================================
// LIMITE DE CENÁRIOS (campo "Quantidade de cenários" da tela)
// ======================================================

const MAX_SCENARIOS_LIMIT = 50;
const PRIORITY_ORDER = { alta: 0, media: 1, baixa: 2 };

function parseMaxScenarios(raw) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null; // vazio = a IA decide
  return Math.min(n, MAX_SCENARIOS_LIMIT);
}

// Garante o limite mesmo se a IA devolver cenários a mais:
// mantém os de maior prioridade e remove componentes que ficaram sem cenários.
function limitScenarios(result, max) {
  if (!max || !Array.isArray(result?.components)) return result;
  const all = result.components.flatMap((c, ci) =>
    (c.testPoints || []).map((t, ti) => ({ ci, ti, o: PRIORITY_ORDER[t.priority] ?? 1 }))
  );
  if (all.length <= max) return result;
  const keep = new Set(
    all.sort((a, b) => a.o - b.o || a.ci - b.ci || a.ti - b.ti).slice(0, max).map((x) => `${x.ci}:${x.ti}`)
  );
  const components = result.components
    .map((c, ci) => ({ ...c, testPoints: (c.testPoints || []).filter((_, ti) => keep.has(`${ci}:${ti}`)) }))
    .filter((c) => c.testPoints.length);
  return { ...result, components };
}

const testesReserva = [];
function testeReservaPermitido() {
  const agora = Date.now();
  while (testesReserva.length && agora - testesReserva[0] > 3600_000) testesReserva.shift();
  if (testesReserva.length >= 10) return false;
  testesReserva.push(agora);
  return true;
}

// A IA reserva segue o formato pelo texto do pedido (não por schema obrigatório):
// aqui garantimos campos e valores válidos antes de mostrar na tela.
function normalizaAnalise(r) {
  const nivel = (v, p = "media") => {
    const x = String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return ["alta", "media", "baixa"].includes(x) ? x : p;
  };
  const um = (v, lista, p) => (lista.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : p);
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const txt = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
  const TIPOS = ["input", "button", "select", "checkbox", "radio", "link", "table", "menu", "pagination", "message", "other"];
  const CATS = ["funcional", "validacao", "navegacao", "erro", "usabilidade", "limite", "seguranca"];
  return {
    summary: txt(r?.summary),
    confidence: nivel(r?.confidence),
    components: arr(r?.components).map((c) => ({
      name: txt(c?.name) || "Componente",
      type: um(c?.type, TIPOS, "other"),
      location: txt(c?.location),
      confidence: nivel(c?.confidence),
      observations: arr(c?.observations).map(txt),
      testPoints: arr(c?.testPoints).map((t) => ({
        title: txt(t?.title) || "Cenário",
        category: um(String(t?.category || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""), CATS, "funcional"),
        priority: nivel(t?.priority),
        steps: arr(t?.steps).map(txt),
        expected: txt(t?.expected),
        rationale: txt(t?.rationale),
      })),
    })).filter((c) => c.testPoints.length || c.observations.length),
    notCovered: arr(r?.notCovered).map((n) => ({ title: txt(n?.title), reason: txt(n?.reason), priority: nivel(n?.priority) })).filter((n) => n.title),
  };
}

// ======================================================
// ROTA DE ANÁLISE
// ======================================================

app.post("/api/analyze", upload.single("screenshot"), async (req, res) => {
  try {
    const cfg = getConfig();
    const maxScenarios = parseMaxScenarios(req.body?.maxScenarios);
    const extra = { requestedScenarios: maxScenarios };

    if (!req.file) {
      return res.status(400).json({ error: "Envie uma imagem." });
    }

    if (cfg.demoMode) {
      return res.json(limitScenarios({ ...extra,
        summary: "Modo demonstração: tela de consulta com CPF, tipo de operação e botão Continuar (dados fictícios, a IA não foi chamada).",
        confidence: "alta",
        components: [
          {
            name: "CPF", type: "input", location: "Topo do formulário", confidence: "alta",
            observations: ["Campo de texto com máscara 000.000.000-00", "Rótulo com asterisco indicando obrigatoriedade"],
            testPoints: [
              { title: "CPF válido", category: "funcional", priority: "alta", steps: ["Digitar um CPF válido", "Clicar em Continuar"], expected: "Fluxo segue para a próxima etapa.", rationale: "Campo com máscara de CPF indica fluxo principal dependente de dado válido." },
              { title: "CPF inválido", category: "validacao", priority: "alta", steps: ["Digitar 111.111.111-11", "Clicar em Continuar"], expected: "Mensagem de erro de CPF inválido.", rationale: "Máscara garante formato, mas não a validade dos dígitos verificadores." },
              { title: "CPF incompleto", category: "validacao", priority: "alta", steps: ["Digitar 123.456", "Clicar em Continuar"], expected: "Sistema impede o avanço e informa o erro.", rationale: "A máscara permite digitação parcial do campo." },
              { title: "CPF com caracteres não numéricos", category: "limite", priority: "media", steps: ["Tentar digitar letras e símbolos"], expected: "Caracteres não numéricos são rejeitados.", rationale: "Campo de texto livre com máscara numérica." },
              { title: "Campo vazio", category: "validacao", priority: "alta", steps: ["Deixar o campo em branco", "Clicar em Continuar"], expected: "Mensagem de campo obrigatório.", rationale: "O asterisco no rótulo indica campo obrigatório." }
            ]
          },
          {
            name: "Botão Continuar", type: "button", location: "Rodapé do formulário", confidence: "alta",
            observations: ["Botão primário de ação, em destaque"],
            testPoints: [
              { title: "Duplo clique", category: "usabilidade", priority: "media", steps: ["Preencher dados válidos", "Clicar duas vezes rapidamente"], expected: "A ação é executada uma única vez.", rationale: "Botões de envio estão sujeitos a submissões duplicadas." },
              { title: "Clique sem preencher campos", category: "erro", priority: "alta", steps: ["Clicar em Continuar com o formulário vazio"], expected: "Mensagens de validação nos campos obrigatórios.", rationale: "Botão de envio depende de campos obrigatórios visíveis na tela." }
            ]
          },
          {
            name: "Tipo de operação", type: "select", location: "Abaixo do CPF", confidence: "media",
            observations: ["Combo com opção padrão selecionada"],
            testPoints: [
              { title: "Navegar por todas as opções", category: "funcional", priority: "baixa", steps: ["Abrir o combo", "Selecionar cada opção"], expected: "Cada opção é selecionável e exibida corretamente.", rationale: "Combo com lista de valores exige conferência das opções." }
            ]
          }
        ],
        notCovered: [
          { title: "Limite máximo de caracteres", reason: "Não há indicação visual de limite nos campos.", priority: "media" },
          { title: "Atualização da página durante o preenchimento", reason: "Verificar se os dados são mantidos ou descartados.", priority: "media" },
          { title: "Permissão de usuário", reason: "A tela pode se comportar diferente conforme o perfil.", priority: "alta" },
          { title: "Mensagem de erro do servidor", reason: "A tela não mostra como falhas de backend são exibidas.", priority: "media" }
        ],
        demo: true,
        provider: "demo",
        model: "demo",
      }, maxScenarios));
    }

    if (!cfg.apiKey || cfg.apiKey.includes("COLOQUE_SUA_CHAVE")) {
      return res.status(500).json({
        error: "GEMINI_API_KEY não configurada. Cole sua chave no arquivo .env e salve.",
      });
    }

    const userText =
      "Analise esta tela e gere o checklist de testes no JSON solicitado." +
      (maxScenarios
        ? ` Gere NO MÁXIMO ${maxScenarios} cenário(s) no total, somando os testPoints de todos os componentes. ` +
          `Escolha os de maior risco e prioridade. Componentes sem cenário podem ficar de fora.`
        : "");
    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: req.file.mimetype,
                data: req.file.buffer.toString("base64"),
              },
            },
            { text: userText },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.2,
      },
    };

    // Para cada modelo: tenta até 2 vezes se estiver sobrecarregado (503/500/504).
    // Se continuar falhando (ou 404/429/modelo descontinuado), passa ao próximo modelo.
    // Modelo com a cota gratuita esgotada é pulado sem nova chamada por um tempo.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const TRANSIENT = [500, 503, 504];
    const NEXT_MODEL = [404, 429, ...TRANSIENT];
    const MAX_ATTEMPTS = 2; // cada tentativa conta na cota gratuita do Google
    // Tempo máximo: evita que um Gemini travado deixe a tela em "Analisando…" até o limite
    // de 5 min da Vercel. Cada tentativa tem até 100 s e a análise inteira até 210 s.
    // Com a IA reserva configurada, o Gemini tem menos tempo (RESERVA_APOS_S) e o resto fica para a reserva.
    const reserva = reservaConfig();
    const ATTEMPT_MS = Math.min(Number(process.env.GEMINI_ATTEMPT_MS) || 100_000, reserva.ativa ? reserva.aposMs : Infinity);
    const deadline = Date.now() + (reserva.ativa ? reserva.aposMs : Number(process.env.GEMINI_TOTAL_MS) || 210_000);
    const MIN_RESTANTE = Math.min(15_000, ATTEMPT_MS / 2); // não começa tentativa sem tempo útil
    let timedOut = false;
    let last = null;
    let usedModel = null;
    let googleData = null;

    let houveSobrecarga = false;
    // Teste da reserva: /api/analyze?reserva=1 pula o Gemini (limitado a 10 por hora).
    const forcarReserva = req.query?.reserva === "1" && reserva.ativa && testeReservaPermitido();
    modelLoop: for (const model of forcarReserva ? [] : cfg.models) {
      if (cotaEsgotada(model)) {
        if (!last) last = { status: 429, data: { error: { message: "quota (cota gratuita esgotada)" } } };
        continue;
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const restante = deadline - Date.now();
        if (restante < MIN_RESTANTE) break modelLoop; // sem tempo para outra tentativa
        let response, data;
        try {
          ({ response, data } = await geminiFetch(
            cfg,
            `/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, restante)),
            }
          ));
        } catch (e) {
          if (e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
          timedOut = true;
          console.error(`Gemini (${model}) não respondeu a tempo na tentativa ${attempt}.`);
          last = { status: 504, data: { error: { message: "Tempo esgotado esperando o Gemini." } } };
          continue modelLoop; // modelo lento/travado: tenta o próximo da lista
        }

        if (response.ok) {
          usedModel = model;
          googleData = data;
          last = null;
          break modelLoop;
        }

        console.error(
          `Erro da Gemini (${model}, tentativa ${attempt}/${MAX_ATTEMPTS}):`,
          response.status,
          data?.error?.message
        );
        if (response.status === 429) marcarCota(model, data);
        if (TRANSIENT.includes(response.status)) houveSobrecarga = true;
        // Mostra a sobrecarga (o motivo de fundo) em vez de "cota" ou "modelo antigo" de um modelo reserva.
        if (!(houveSobrecarga && last && TRANSIENT.includes(last.status) && !TRANSIENT.includes(response.status))) {
          last = { status: response.status, data };
        }

        if (TRANSIENT.includes(response.status) && attempt < MAX_ATTEMPTS) {
          const espera = 2000; // 2 s antes da segunda tentativa
          if (deadline - Date.now() > espera + MIN_RESTANTE) {
            await sleep(espera);
            continue;
          }
        }
        if (NEXT_MODEL.includes(response.status) || modeloIndisponivel(response.status, data)) continue modelLoop;
        break modelLoop; // 401/403/400 de chave ou pedido: trocar de modelo não resolve
      }
    }

    if (!googleData && !last) {
      last = { status: 504, data: { error: { message: "Tempo esgotado esperando o Gemini." } } };
      timedOut = true;
    }

    // Resposta do Gemini → resultado, ou o erro que seria mostrado.
    let result = null;
    let erroGemini = null; // { status, body }
    if (last) {
      erroGemini =
        timedOut && last.status === 504
          ? { status: 504, body: { error: "A IA está demorando mais que o normal para responder. Tente de novo em instantes ou informe uma quantidade menor de cenários." } }
          : { status: 502, body: { error: explainError(last.status, last.data, cfg), details: last.data?.error?.message } };
    } else {
      const text = googleData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();
      if (!text) {
        const blocked = googleData?.promptFeedback?.blockReason;
        erroGemini = { status: 502, body: { error: blocked ? `A Gemini bloqueou a imagem (${blocked}). Tente outro print.` : "A Gemini não retornou conteúdo para a análise. Tente novamente." } };
      } else {
        try {
          result = JSON.parse(text);
        } catch {
          console.error("Resposta não-JSON da Gemini:", text);
          erroGemini = { status: 502, body: { error: "A IA retornou uma resposta que não pôde ser convertida em JSON. Tente novamente." } };
        }
      }
    }

    let provider = "Gemini";
    if (!result && reserva.ativa) {
      // Gemini falhou ou demorou: tenta a IA reserva (Cloudflare ou Mistral).
      console.error("Gemini sem resultado; usando a IA reserva.", erroGemini?.body?.error);
      try {
        const r = await gerarNaReserva({
          system: systemPrompt,
          texto: userText,
          schema: responseSchema,
          imagem: { mime: req.file.mimetype, base64: req.file.buffer.toString("base64") },
          totalMs: 120_000,
          tentativaMs: 60_000,
        });
        result = normalizaAnalise(r.data);
        provider = r.provider;
        usedModel = r.model;
      } catch (e) {
        console.error("IA reserva também falhou:", e?.message);
        erroGemini.body.error += ` A IA reserva (${reserva.provedor}) também não conseguiu: ${e?.message || "erro"}`;
      }
    }

    if (!result) return res.status(erroGemini.status).json(erroGemini.body);

    return res.json({ ...limitScenarios(result, maxScenarios), ...extra, demo: false, provider, model: usedModel });
  } catch (error) {
    console.error("Erro no /api/analyze:", error);
    return res.status(500).json({
      error: error?.message || "Erro inesperado ao analisar a imagem.",
    });
  }
});


// ======================================================
// ERRO DE UPLOAD
// ======================================================

app.use((err, _req, res, _next) => {
  console.error("Erro de upload:", err);
  return res.status(400).json({ error: err.message || "Erro no upload." });
});


// ======================================================
// INICIA SERVIDOR
// ======================================================

const startCfg = getConfig();
const ON_VERCEL = !!process.env.VERCEL;

// Na Vercel o app é exportado e a plataforma cuida do servidor.
// No computador (npm start), continua escutando só em 127.0.0.1, como antes.
if (!ON_VERCEL) app.listen(startCfg.port, "127.0.0.1", async () => {
  console.log("");
  console.log(`Valida Vision rodando em http://localhost:${startCfg.port}`);
  console.log(`Modelos: ${startCfg.models.join(" -> ")}`);
  console.log(`DEMO_MODE: ${startCfg.demoMode}`);
  console.log(`Chave: ${maskKey(startCfg.apiKey)}`);
  console.log("Para trocar a chave, edite o .env e salve. Não precisa reiniciar.");

  if (!startCfg.demoMode && startCfg.apiKey) {
    try {
      const r = await fetch(`http://127.0.0.1:${startCfg.port}/api/health`);
      const h = await r.json();
      console.log(`Teste da chave: ${h.ok ? "OK" : "FALHOU"} - ${h.message}`);
    } catch {
      /* ignora */
    }
  }
  console.log("");
});

export default app;
