// Perfil e "visto por último" (v0.38) — ficam só neste aparelho (localStorage), nada vai para o servidor.
//  - vvPerfil: o nome da pessoa, digitado uma vez e reaproveitado no desafio, nos comentários do álbum e no Início.
//  - vvVisto: quando a pessoa abriu cada área pela última vez (para o "novo" nos blocos do Início).
(function () {
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ok */ } }
  var limpa = function (n) { return String(n || "").replace(/\s+/g, " ").trim().slice(0, 40); };
  window.vvPerfil = {
    nome: function () { return limpa(get("vv-nome") || get("vv-album-nome") || ""); },
    primeiro: function () { return this.nome().split(" ")[0] || ""; },
    definir: function (n) {
      n = limpa(n);
      set("vv-nome", n || null);
      if (n) set("vv-album-nome", n);
      window.dispatchEvent(new CustomEvent("vv-perfil", { detail: n }));
      return n;
    },
  };
  var K = "vv-visto";
  function mapa() { try { return JSON.parse(get(K) || "null"); } catch (e) { return null; } }
  window.vvVisto = {
    // null = nunca abriu a Toca neste aparelho (aí nada aparece como "novo")
    quando: function (area) { var m = mapa(); return m ? (m[area] || m._inicio || null) : null; },
    primeiraVez: function () { return !mapa(); },
    marcar: function (area) { var m = mapa() || { _inicio: new Date().toISOString() }; m[area] = new Date().toISOString(); set(K, JSON.stringify(m)); },
    iniciar: function () { if (!mapa()) set(K, JSON.stringify({ _inicio: new Date().toISOString() })); },
  };
  // Abrir a página de uma área conta como "visto".
  var AREA = { "/elogios.html": "elogios", "/album.html": "album", "/desafio.html": "desafio", "/sugestoes.html": "sugestoes", "/sentimento.html": "sentimento" };
  var area = AREA[location.pathname];
  if (area && !/[?&]apresentar=1/.test(location.search)) window.vvVisto.marcar(area);
})();

// App instalável + lembrete de sexta.
// Registra o service worker (/sw.js) e põe um botão 🔔 na barra superior com:
//  - Instalar o app (Android/PC: botão; iPhone: instruções do Safari)
//  - Lembrete de sexta (notificação; no iPhone só funciona com o app instalado)
(function () {
  if (!("serviceWorker" in navigator)) return;
  var reg = null, promptInstalar = null, aberto = false;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var temPush = "PushManager" in window && "Notification" in window;

  navigator.serviceWorker.register("/sw.js").then(function (r) { reg = r; atualiza(); }).catch(function () {});
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); promptInstalar = e; atualiza(); });
  window.addEventListener("appinstalled", function () { instalado = true; promptInstalar = null; atualiza(); });

  var SINO = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var btn, pop;

  function b64(s) {
    var p = "=".repeat((4 - (s.length % 4)) % 4), r = (s + p).replace(/-/g, "+").replace(/_/g, "/"), raw = atob(r), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function inscricaoAtual() { return reg && reg.pushManager ? reg.pushManager.getSubscription() : Promise.resolve(null); }

  function msg(t, erro) { var m = pop && pop.querySelector(".vv-app-msg"); if (m) { m.textContent = t || ""; m.className = "vv-app-msg" + (erro ? " erro" : ""); } }

  // Pede a permissão e inscreve este aparelho. Devolve a inscrição.
  function inscrever() {
    if (Notification.permission === "denied") return Promise.reject(new Error("As notificações estão bloqueadas para este site. Libere nas configurações do navegador e tente de novo."));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("Você não permitiu as notificações.");
      return fetch("/api/lembretes/chave").then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d.publicKey) throw new Error(d.error || "Lembretes indisponíveis.");
      return navigator.serviceWorker.ready.then(function (r) { reg = r; return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(d.publicKey) }); });
    }).then(function (sub) {
      return fetch("/api/lembretes/inscrever", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) })
        .then(function (r) { if (!r.ok) throw new Error("Não consegui ativar agora."); return sub; });
    });
  }
  function ativar() {
    msg("Ativando…");
    inscrever().then(function () { atualiza(); msg("Pronto! Você recebe um lembrete toda sexta de manhã. 💚"); })
      .catch(function (e) { msg(e.message || "Não consegui ativar.", true); });
  }

  // ---------- Aviso de elogio (v0.38) ----------
  // Liga: garante a inscrição deste aparelho e guarda o nome junto dela no servidor.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ok */ } }
  function avisoNome() { return lsGet("vv-aviso-elogio") || ""; }
  function enviarNome(sub, nome) {
    return fetch("/api/lembretes/nome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, nome: nome }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Não consegui salvar agora."); return d; }); });
  }
  function ligarAviso(nome) {
    nome = String(nome || "").replace(/\s+/g, " ").trim();
    if (nome.length < 2) return Promise.reject(new Error("Escreva o seu nome."));
    if (!temPush) return Promise.reject(new Error(ios && !instalado ? "No iPhone, instale o app primeiro para receber avisos." : "Este navegador não permite notificações."));
    return inscricaoAtual().then(function (sub) { return sub || inscrever(); })
      .then(function (sub) { return enviarNome(sub, nome); })
      .then(function () { lsSet("vv-aviso-elogio", nome); if (window.vvPerfil && !window.vvPerfil.nome()) window.vvPerfil.definir(nome); atualiza(); return nome; });
  }
  function desligarAviso() {
    return inscricaoAtual().then(function (sub) { if (sub) return enviarNome(sub, ""); })
      .then(function () { lsSet("vv-aviso-elogio", null); atualiza(); });
  }
  function estadoAviso() {
    if (!temPush) return Promise.resolve({ pode: false, ligado: false });
    return inscricaoAtual().then(function (sub) {
      var n = avisoNome();
      if (!sub && n) { lsSet("vv-aviso-elogio", null); n = ""; }
      return { pode: true, inscrito: !!sub, ligado: !!(sub && n), nome: n };
    });
  }
  function desativar() {
    msg("Desativando…");
    inscricaoAtual().then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      lsSet("vv-aviso-elogio", null);
      return sub.unsubscribe().then(function () {
        return fetch("/api/lembretes/cancelar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: endpoint }) });
      });
    }).then(function () { atualiza(); msg("Lembrete desativado."); }).catch(function () { msg("Não consegui desativar agora.", true); });
  }

  function atualiza() {
    if (!pop) return;
    var rec = pop.querySelector(".vv-app-rec");
    if (rec) rec.hidden = !(window.vvRecado && window.vvRecado.tem());
    var inst = pop.querySelector(".vv-app-inst"), lem = pop.querySelector(".vv-app-lem");
    if (instalado) inst.innerHTML = '<b>📲 App instalado</b><span>Abra o Toca dos Bug Hunters pelo ícone na tela inicial.</span>';
    else if (promptInstalar) inst.innerHTML = '<b>📲 Instalar o app</b><span>Ícone na tela inicial, abre direto, sem barra do navegador.</span><button type="button" class="btn-primary btn-sm" data-acao="instalar">Instalar</button>';
    else if (ios) inst.innerHTML = '<b>📲 Instalar no iPhone</b><span>No Safari, toque em <b>Compartilhar</b> (□↑) e depois em <b>Adicionar à Tela de Início</b>.</span>';
    else inst.innerHTML = '<b>📲 Instalar o app</b><span>No menu do navegador (⋮), escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</span>';

    var av = pop.querySelector(".vv-app-elo");
    estadoAviso().then(function (st) {
      if (!st.pode) { av.hidden = true; return; }
      av.hidden = false;
      var nomeSug = (window.vvPerfil && window.vvPerfil.nome()) || "";
      av.innerHTML = st.ligado
        ? '<b>💚 Aviso de elogio: ligado</b><span>Quando alguém elogiar <b>' + esc(st.nome) + '</b>, este aparelho recebe um aviso.</span><button type="button" class="btn-outline btn-sm" data-acao="aviso-off">Desligar</button>'
        : '<b>💚 Aviso de elogio</b><span>Saiba na hora quando alguém te elogiar. Seu nome fica guardado só para isso.</span><div class="vv-app-linha"><input class="vv-app-nome" maxlength="40" autocomplete="name" placeholder="Seu nome" value="' + esc(nomeSug) + '"><button type="button" class="btn-primary btn-sm" data-acao="aviso-on">Ligar</button></div>';
    });
    if (!temPush) {
      lem.innerHTML = '<b>🔔 Lembrete de sexta</b><span>' + (ios && !instalado ? "No iPhone, instale o app primeiro (acima) e abra por ele para ativar o lembrete." : "Este navegador não permite notificações.") + "</span>";
      return;
    }
    inscricaoAtual().then(function (sub) {
      lem.innerHTML = sub
        ? '<b>🔔 Lembrete de sexta: ativado</b><span>Toda sexta de manhã chega um aviso para responder o Sentimento da Semana.</span><button type="button" class="btn-outline btn-sm" data-acao="desativar">Desativar</button>'
        : '<b>🔔 Lembrete de sexta</b><span>Receba um aviso toda sexta de manhã para responder o Sentimento da Semana. Anônimo: não pedimos nome nem e-mail.</span><button type="button" class="btn-primary btn-sm" data-acao="ativar">Ativar lembrete</button>';
      if (btn) btn.classList.toggle("on", !!sub);
    });
  }

  function abrir(v) {
    aberto = v === undefined ? !aberto : v;
    pop.hidden = !aberto;
    btn.setAttribute("aria-expanded", String(aberto));
    if (aberto) { msg(""); atualiza(); }
  }

  function monta() {
    var barra = document.querySelector(".topbar");
    if (!barra || barra.querySelector(".vv-app-btn")) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vv-app-btn";
    btn.title = "App e lembrete de sexta";
    btn.setAttribute("aria-label", "App e lembrete de sexta");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = SINO;
    var tema = barra.querySelector(".vv-tema-btn");
    if (tema) barra.insertBefore(btn, tema); else barra.appendChild(btn);
    if (!barra.querySelector(".spacer") && !barra.querySelector(".tag") && !tema) btn.style.marginLeft = "auto";
    if (tema && tema.style.marginLeft === "auto") { tema.style.marginLeft = ""; btn.style.marginLeft = "auto"; }

    pop = document.createElement("div");
    pop.className = "vv-app-pop";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "App e lembrete de sexta");
    pop.innerHTML = '<div class="vv-app-item vv-app-rec" hidden><b>📣 Recado da Chefa</b><span>Rever os recados que a chefa deixou para o time.</span><button type="button" class="btn-outline btn-sm" data-acao="recado">Ver recado</button></div><div class="vv-app-item vv-app-inst"></div><div class="vv-app-item vv-app-lem"></div><div class="vv-app-item vv-app-elo" hidden></div><p class="vv-app-msg" role="status"></p>';
    document.body.appendChild(pop);

    btn.addEventListener("click", function (e) { e.stopPropagation(); abrir(); });
    pop.addEventListener("click", function (e) {
      e.stopPropagation();
      var a = e.target.closest("[data-acao]");
      if (!a) return;
      if (a.dataset.acao === "instalar" && promptInstalar) promptInstalar.prompt().then(function () { promptInstalar = null; atualiza(); });
      if (a.dataset.acao === "ativar") ativar();
      if (a.dataset.acao === "desativar") desativar();
      if (a.dataset.acao === "aviso-on") {
        msg("Ligando…");
        ligarAviso(pop.querySelector(".vv-app-nome").value).then(function (n) { msg("Pronto! Você vai saber quando alguém elogiar " + n.split(" ")[0] + ". 💚"); })
          .catch(function (err) { msg(err.message || "Não consegui ligar.", true); });
      }
      if (a.dataset.acao === "aviso-off") desligarAviso().then(function () { msg("Aviso de elogio desligado."); }).catch(function () { msg("Não consegui desligar agora.", true); });
      if (a.dataset.acao === "recado" && window.vvRecado) { abrir(false); window.vvRecado.abrir(); }
    });
    document.addEventListener("click", function () { if (aberto) abrir(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && aberto) abrir(false); });
    atualiza();
  }

  window.addEventListener("vv-recado", function () { atualiza(); });
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]; }); }
  window.vvApp = { abrir: function () { if (btn) { abrir(true); window.scrollTo(0, 0); } }, ligarAviso: ligarAviso, estadoAviso: estadoAviso };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(monta, 0); });
  else setTimeout(monta, 0);
})();
