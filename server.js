import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");

const app = express();


// ======================================================
// CONFIGURAÇÃO (RELIDA DO .env A CADA REQUISIÇÃO)
// Para trocar a chave: edite o .env e salve. Não precisa reiniciar.
// O valor do .env tem prioridade sobre variáveis do Windows.
// ======================================================

const DEFAULT_MODELS = ["gemini-3.7-flash", "gemini-3.6-flash"];

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

app.use(express.static(path.join(__dirname, "public")));


// ======================================================
// PROMPT DO VALIDAI VISION
// ======================================================

const systemPrompt = `
Você é o ValidAI Vision, um assistente especialista em QA e testes de interfaces.

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
  },

  required: [
    "summary",
    "confidence",
    "components",
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
      "Limite de uso (cota) da Gemini atingido para esta chave/modelo. " +
      "Aguarde um pouco, troque a chave ou troque o modelo no .env."
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
    const { response, data } = await geminiFetch(cfg, "/models?pageSize=200");

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        key: maskKey(cfg.apiKey),
        message: explainError(response.status, data, cfg),
      });
    }

    const available = (data.models || []).map((m) => m.name.replace(/^models\//, ""));
    const found = cfg.models.filter((m) => available.includes(m));

    return res.json({
      ok: true,
      key: maskKey(cfg.apiKey),
      models: cfg.models,
      modelsFound: found,
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
// ROTA DE ANÁLISE
// ======================================================

app.post("/api/analyze", upload.single("screenshot"), async (req, res) => {
  try {
    const cfg = getConfig();

    if (!req.file) {
      return res.status(400).json({ error: "Envie uma imagem." });
    }

    if (cfg.demoMode) {
      return res.json({
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
      });
    }

    if (!cfg.apiKey || cfg.apiKey.includes("COLOQUE_SUA_CHAVE")) {
      return res.status(500).json({
        error: "GEMINI_API_KEY não configurada. Cole sua chave no arquivo .env e salve.",
      });
    }

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
            {
              text: "Analise esta tela e gere o checklist de testes no JSON solicitado.",
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.2,
      },
    };

    // Para cada modelo: tenta até 3 vezes se estiver sobrecarregado (503/500/504),
    // com espera crescente. Se continuar falhando (ou 404/429), passa ao próximo modelo.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const TRANSIENT = [500, 503, 504];
    const NEXT_MODEL = [404, 429, ...TRANSIENT];
    const MAX_ATTEMPTS = 3;
    let last = null;
    let usedModel = null;
    let googleData = null;

    modelLoop: for (const model of cfg.models) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { response, data } = await geminiFetch(
          cfg,
          `/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

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
        last = { status: response.status, data };

        if (TRANSIENT.includes(response.status) && attempt < MAX_ATTEMPTS) {
          await sleep(1500 * attempt * attempt); // 1,5s, 6s
          continue;
        }
        if (NEXT_MODEL.includes(response.status)) continue modelLoop;
        break modelLoop; // 401/403/400: trocar de modelo não resolve
      }
    }

    if (last) {
      return res.status(502).json({
        error: explainError(last.status, last.data, cfg),
        details: last.data?.error?.message,
      });
    }

    const text = googleData?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      const blocked = googleData?.promptFeedback?.blockReason;
      return res.status(502).json({
        error: blocked
          ? `A Gemini bloqueou a imagem (${blocked}). Tente outro print.`
          : "A Gemini não retornou conteúdo para a análise. Tente novamente.",
      });
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      console.error("Resposta não-JSON da Gemini:", text);
      return res.status(502).json({
        error: "A IA retornou uma resposta que não pôde ser convertida em JSON. Tente novamente.",
      });
    }

    return res.json({ ...result, demo: false, provider: "Gemini", model: usedModel });
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

app.listen(startCfg.port, "127.0.0.1", async () => {
  console.log("");
  console.log(`ValidAI Vision rodando em http://localhost:${startCfg.port}`);
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
