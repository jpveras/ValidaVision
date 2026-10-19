// Recado da Chefa: pop-up com a mensagem que a gestora configurou no painel.
// Aparece ao abrir a Toca (PC ou app), conforme a frequência escolhida:
//   uma-vez (até o recado mudar) · diario · sempre.
// Não aparece no telão (modo apresentação), na moderação nem na Área da Gestora.
// No Início, espera a mensagem de boas-vindas sair (evento vv-bv-fim).
(function () {
  var K = "vv-recado";
  var recado = null, aberto = false, anterior = null;
  var pagina = location.pathname.replace(/^\/|\.html$/g, "") || "index";
  var semAuto = /[?&]apresentar=1/.test(location.search) || pagina === "elogios-moderacao" || pagina === "gestora" || pagina === "sentimento-gestora";

  function lerVisto() { try { return JSON.parse(localStorage.getItem(K) || "null") || {}; } catch (e) { return {}; } }
  function marcarVisto() { if (!recado || !recado.id) return; try { localStorage.setItem(K, JSON.stringify({ id: recado.id, dia: hoje() })); } catch (e) { /* ok */ } }
  function hoje() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function deveMostrar(r) {
    var v = lerVisto();
    if (r.frequencia === "sempre") return true;
    if (r.frequencia === "diario") return v.id !== r.id || v.dia !== hoje();
    return v.id !== r.id;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]; }); }

  function mostrar(r, previa) {
    if (aberto || !r || !r.mensagem) return;
    aberto = true;
    anterior = document.activeElement;
    var fundo = document.createElement("div");
    fundo.className = "vv-recado-fundo";
    fundo.innerHTML =
      '<div class="vv-recado" role="dialog" aria-modal="true" aria-labelledby="vvRecadoTit">' +
      '<button type="button" class="vv-recado-x" aria-label="Fechar">✕</button>' +
      '<div class="vv-recado-topo"><span class="vv-recado-ico" aria-hidden="true">📣</span><h2 id="vvRecadoTit">' + esc(r.titulo || "Recado da Chefa!") + "</h2>" +
      (previa ? '<span class="vv-recado-previa">Pré-visualização</span>' : "") + "</div>" +
      '<div class="vv-recado-corpo"><p>' + esc(r.mensagem) + "</p>" + (r.assinatura ? '<p class="vv-recado-ass">— ' + esc(r.assinatura) + "</p>" : "") + "</div>" +
      '<div class="vv-recado-pe"><button type="button" class="btn-primary vv-recado-ok">Obrigado! 💚</button></div></div>';
    document.body.appendChild(fundo);
    document.documentElement.classList.add("vv-recado-aberto");
    var fechar = function () {
      if (!aberto) return;
      aberto = false;
      if (!previa) marcarVisto();
      fundo.classList.add("saindo");
      document.documentElement.classList.remove("vv-recado-aberto");
      setTimeout(function () { fundo.remove(); }, 180);
      document.removeEventListener("keydown", tecla);
      if (anterior && anterior.focus) try { anterior.focus(); } catch (e) { /* ok */ }
    };
    var tecla = function (e) { if (e.key === "Escape") fechar(); };
    fundo.querySelector(".vv-recado-x").onclick = fechar;
    fundo.querySelector(".vv-recado-ok").onclick = fechar;
    fundo.addEventListener("click", function (e) { if (e.target === fundo) fechar(); });
    document.addEventListener("keydown", tecla);
    setTimeout(function () { var b = fundo.querySelector(".vv-recado-ok"); if (b) b.focus(); }, 50);
  }

  function carregar() {
    return fetch("/api/recado", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { recado = d && d.ativo ? d : null; window.dispatchEvent(new CustomEvent("vv-recado", { detail: !!recado })); return recado; })
      .catch(function () { return null; });
  }

  window.vvRecado = {
    tem: function () { return !!recado; },
    abrir: function () { if (recado) mostrar(recado, false); },
    previa: function (r) { mostrar(r, true); },
  };

  carregar().then(function (r) {
    if (!r || semAuto || !deveMostrar(r)) return;
    // espera a página assentar um pouco antes de abrir (e, no Início, a mensagem de boas-vindas sair)
    var abre = function () { setTimeout(function () { if (!document.body.classList.contains("present")) mostrar(r, false); }, 600); };
    if (document.documentElement.classList.contains("vv-bv")) window.addEventListener("vv-bv-fim", abre, { once: true });
    else abre();
  });
})();
