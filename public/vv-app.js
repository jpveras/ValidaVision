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

  function ativar() {
    msg("Ativando…");
    if (Notification.permission === "denied") return msg("As notificações estão bloqueadas para este site. Libere nas configurações do navegador e tente de novo.", true);
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("Você não permitiu as notificações.");
      return fetch("/api/lembretes/chave").then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d.publicKey) throw new Error(d.error || "Lembretes indisponíveis.");
      return navigator.serviceWorker.ready.then(function (r) { reg = r; return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(d.publicKey) }); });
    }).then(function (sub) {
      return fetch("/api/lembretes/inscrever", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) })
        .then(function (r) { if (!r.ok) throw new Error("Não consegui ativar agora."); });
    }).then(function () { atualiza(); msg("Pronto! Você recebe um lembrete toda sexta de manhã. 💚"); })
      .catch(function (e) { msg(e.message || "Não consegui ativar.", true); });
  }
  function desativar() {
    msg("Desativando…");
    inscricaoAtual().then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
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
    pop.innerHTML = '<div class="vv-app-item vv-app-rec" hidden><b>📣 Recado da Chefa</b><span>Rever o recado que a chefa deixou para o time.</span><button type="button" class="btn-outline btn-sm" data-acao="recado">Ver recado</button></div><div class="vv-app-item vv-app-inst"></div><div class="vv-app-item vv-app-lem"></div><p class="vv-app-msg" role="status"></p>';
    document.body.appendChild(pop);

    btn.addEventListener("click", function (e) { e.stopPropagation(); abrir(); });
    pop.addEventListener("click", function (e) {
      e.stopPropagation();
      var a = e.target.closest("[data-acao]");
      if (!a) return;
      if (a.dataset.acao === "instalar" && promptInstalar) promptInstalar.prompt().then(function () { promptInstalar = null; atualiza(); });
      if (a.dataset.acao === "ativar") ativar();
      if (a.dataset.acao === "desativar") desativar();
      if (a.dataset.acao === "recado" && window.vvRecado) { abrir(false); window.vvRecado.abrir(); }
    });
    document.addEventListener("click", function () { if (aberto) abrir(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && aberto) abrir(false); });
    atualiza();
  }

  window.addEventListener("vv-recado", function () { atualiza(); });
  window.vvApp = { abrir: function () { if (btn) { abrir(true); window.scrollTo(0, 0); } } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(monta, 0); });
  else setTimeout(monta, 0);
})();
