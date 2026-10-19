// ======================================================
// ÁREA DA GESTORA (/gestora.html)
//
// Um lugar só da gestora, aberto pelo ícone 🔐 ao lado do sino: Sentimento da Semana,
// Recado da Chefa, moderação dos Elogios, Álbum, Sugestões, Lembrete e a troca de senha.
// Cada área continua com a própria API; aqui ficam só a entrada e a senha.
// ======================================================

import express from "express";
import { exigeGestora, confereGestora } from "./sentimentos.js";
import { infoSenha, definirSenha, problemaNaSenha } from "./senha-gestora.js";

export const gestoraRouter = express.Router();
gestoraRouter.use(express.json({ limit: "4kb" }));

// Confere a senha (tela de entrada) e diz se ela já escolheu uma senha própria.
gestoraRouter.get("/", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  let info = null;
  try {
    info = await infoSenha();
  } catch {
    /* sem Blob agora: segue com a original */
  }
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, senhaPropria: !!info, senhaTrocadaEm: info?.atualizadoEm || null });
});

// Troca a senha. O cabeçalho x-gestora-key leva a senha atual (conferida por exigeGestora).
gestoraRouter.put("/senha", async (req, res) => {
  if (!(await exigeGestora(req, res))) return;
  const nova = req.body?.nova;
  const erro = problemaNaSenha(nova);
  if (erro) return res.status(400).json({ error: erro });
  if (nova === String(req.get("x-gestora-key") || "")) return res.status(400).json({ error: "A nova senha é igual à atual." });
  try {
    const r = await definirSenha(nova);
    if (!(await confereGestora(nova))) throw new Error("conferência falhou");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, senhaTrocadaEm: r.atualizadoEm });
  } catch (e) {
    console.error("Erro ao trocar a senha da gestora:", e);
    res.status(500).json({ error: "Não consegui trocar a senha agora. Tente de novo." });
  }
});
