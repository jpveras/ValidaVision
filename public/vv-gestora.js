// Entrada da Área da Gestora: um escudo na barra superior, ao lado do sino 🔔.
// Leva para /gestora.html (lá ela entra com a senha). Quando a gestora está conectada
// neste navegador, o escudo ganha um pontinho verde.
(function () {
  var conectada = false;
  try { conectada = !!localStorage.getItem("vv-gestora"); } catch (e) { /* ok */ }
  var pagina = location.pathname.replace(/^\/|\.html$/g, "") || "index";
  var ESCUDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z"/><rect x="9.2" y="10.6" width="5.6" height="4.6" rx="1"/><path d="M10.4 10.6V9.4a1.6 1.6 0 0 1 3.2 0v1.2"/></svg>';

  function monta() {
    var barra = document.querySelector(".topbar");
    if (!barra || barra.querySelector(".vv-gestora-btn")) return;
    var a = document.createElement("a");
    a.href = "/gestora.html";
    a.className = "vv-gestora-btn" + (conectada ? " on" : "") + (pagina === "gestora" ? " atual" : "");
    var rotulo = conectada ? "Área da Gestora (conectada)" : "Área da Gestora";
    a.title = rotulo;
    a.setAttribute("aria-label", rotulo);
    if (pagina === "gestora") a.setAttribute("aria-current", "page");
    a.innerHTML = ESCUDO;
    var sino = barra.querySelector(".vv-app-btn"), tema = barra.querySelector(".vv-tema-btn"), ref = sino || tema;
    if (ref) barra.insertBefore(a, ref); else barra.appendChild(a);
    // Quem estava "empurrando" os botões para a direita passa a ser o escudo.
    if (ref && ref.style.marginLeft === "auto") { ref.style.marginLeft = ""; a.style.marginLeft = "auto"; }
    else if (!ref && !barra.querySelector(".spacer") && !barra.querySelector(".tag")) a.style.marginLeft = "auto";
  }
  // Depois do sino (vv-app.js também monta com setTimeout 0).
  function depois() { setTimeout(function () { setTimeout(monta, 0); }, 0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", depois); else depois();
})();
