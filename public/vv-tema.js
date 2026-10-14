// Tema claro/escuro de todas as telas.
// Carregado no <head> (antes de desenhar) para não piscar branco.
// Padrão: segue o celular/computador. Se a pessoa tocar no botão, a escolha fica salva neste navegador.
(function () {
  var K = "vv-tema";
  var d = document.documentElement;
  d.dataset.pagina = location.pathname.replace(/^\/|\.html$/g, "") || "index";
  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function salvo() { try { return localStorage.getItem(K); } catch (e) { return null; } }
  function guardar(v) { try { localStorage.setItem(K, v); } catch (e) { /* sem armazenamento */ } }
  function aplica() {
    var s = salvo();
    d.dataset.tema = s === "escuro" || s === "claro" ? s : mq && mq.matches ? "escuro" : "claro";
  }
  aplica();

  var LUA = '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var SOL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var btn = null;
  function atualizaBotao() {
    if (!btn) return;
    var escuro = d.dataset.tema === "escuro";
    btn.innerHTML = escuro ? SOL : LUA;
    btn.title = escuro ? "Modo claro" : "Modo escuro";
    btn.setAttribute("aria-label", escuro ? "Ativar modo claro" : "Ativar modo escuro");
    btn.setAttribute("aria-pressed", String(escuro));
  }
  function avisa() {
    atualizaBotao();
    try { window.dispatchEvent(new CustomEvent("vv-tema", { detail: d.dataset.tema })); } catch (e) { /* ok */ }
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (!salvo()) { aplica(); avisa(); } });

  window.vvTema = {
    escuro: function () { return d.dataset.tema === "escuro"; },
    alternar: function () {
      d.classList.add("vv-tema-anim");
      guardar(d.dataset.tema === "escuro" ? "claro" : "escuro");
      aplica();
      avisa();
      setTimeout(function () { d.classList.remove("vv-tema-anim"); }, 350);
    },
  };

  function criaBotao() {
    var barra = document.querySelector(".topbar");
    if (!barra || barra.querySelector(".vv-tema-btn")) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vv-tema-btn";
    btn.addEventListener("click", window.vvTema.alternar);
    // Nas telas sem "espaçador" na barra, o botão vai para a direita.
    if (!barra.querySelector(".spacer") && !barra.querySelector(".tag")) btn.style.marginLeft = "auto";
    barra.appendChild(btn);
    atualizaBotao();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", criaBotao);
  else criaBotao();
})();
