// Recado da Chefa: pop-up com os recados que a gestora configurou (até 3, v0.35).
// Aparece ao abrir a Toca (PC ou app). Cada recado tem a própria frequência:
//   uma-vez (até o recado mudar) · diario · sempre.
// Com mais de um recado para mostrar, eles aparecem em sequência ("1 de 3" → Próximo).
// Não aparece no telão (modo apresentação), na moderação nem na Área da Gestora.
// No Início, espera a mensagem de boas-vindas sair (evento vv-bv-fim).
(function () {
  var K = "vv-recados", K_ANTIGO = "vv-recado";
  var recados = [], aberto = false, anterior = null;
  var pagina = location.pathname.replace(/^\/|\.html$/g, "") || "index";
  var semAuto = /[?&]apresentar=1/.test(location.search) || pagina === "elogios-moderacao" || pagina === "gestora" || pagina === "sentimento-gestora";

  function hoje() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function lerVistos() {
    var m = {};
    try { m = JSON.parse(localStorage.getItem(K) || "{}") || {}; } catch (e) { m = {}; }
    // Compatível com a versão de um recado só ({ id, dia }).
    try { var a = JSON.parse(localStorage.getItem(K_ANTIGO) || "null"); if (a && a.id && !m[a.id]) m[a.id] = a.dia || hoje(); } catch (e) { /* ok */ }
    return m;
  }
  function marcarVistos(lista) {
    var m = lerVistos(), d = hoje(), ids = {};
    lista.forEach(function (r) { if (r.id) m[r.id] = d; });
    recados.forEach(function (r) { ids[r.id] = 1; });
    Object.keys(m).forEach(function (k) { if (!ids[k]) delete m[k]; }); // esquece recados que não existem mais
    try { localStorage.setItem(K, JSON.stringify(m)); localStorage.removeItem(K_ANTIGO); } catch (e) { /* ok */ }
  }
  function deveMostrar(r, vistos) {
    if (r.frequencia === "sempre") return true;
    if (r.frequencia === "diario") return vistos[r.id] !== hoje();
    return !vistos[r.id];
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]; }); }

  function mostrar(lista, previa) {
    lista = (lista || []).filter(function (r) { return r && r.mensagem; });
    if (aberto || !lista.length) return;
    aberto = true;
    anterior = document.activeElement;
    var i = 0, n = lista.length;
    var fundo = document.createElement("div");
    fundo.className = "vv-recado-fundo";
    document.body.appendChild(fundo);
    document.documentElement.classList.add("vv-recado-aberto");
    function desenha() {
      var r = lista[i], ultimo = i === n - 1;
      fundo.innerHTML =
        '<div class="vv-recado" role="dialog" aria-modal="true" aria-labelledby="vvRecadoTit">' +
        '<button type="button" class="vv-recado-x" aria-label="Fechar">✕</button>' +
        '<div class="vv-recado-topo"><span class="vv-recado-ico" aria-hidden="true">📣</span><h2 id="vvRecadoTit">' + esc(r.titulo || "Recado da Chefa!") + "</h2>" +
        (previa ? '<span class="vv-recado-previa">Pré-visualização</span>' : "") +
        (n > 1 ? '<span class="vv-recado-cont">' + (i + 1) + " de " + n + "</span>" : "") + "</div>" +
        '<div class="vv-recado-corpo"><p>' + esc(r.mensagem) + "</p>" + (r.assinatura ? '<p class="vv-recado-ass">— ' + esc(r.assinatura) + "</p>" : "") + "</div>" +
        '<div class="vv-recado-pe">' +
        (n > 1 ? '<div class="vv-recado-pontos" aria-hidden="true">' + lista.map(function (_, k) { return '<i class="' + (k === i ? "on" : "") + '"></i>'; }).join("") + "</div>" : "") +
        (i > 0 ? '<button type="button" class="btn-outline vv-recado-voltar">‹ Anterior</button>' : "") +
        '<button type="button" class="btn-primary vv-recado-ok">' + (ultimo ? "Obrigado! 💚" : "Próximo ›") + "</button></div></div>";
      fundo.querySelector(".vv-recado-x").onclick = fechar;
      fundo.querySelector(".vv-recado-ok").onclick = function () { if (ultimo) fechar(); else { i++; desenha(); foco(); } };
      var v = fundo.querySelector(".vv-recado-voltar");
      if (v) v.onclick = function () { i--; desenha(); foco(); };
    }
    function foco() { setTimeout(function () { var b = fundo.querySelector(".vv-recado-ok"); if (b) b.focus(); }, 50); }
    function fechar() {
      if (!aberto) return;
      aberto = false;
      if (!previa) marcarVistos(lista);
      fundo.classList.add("saindo");
      document.documentElement.classList.remove("vv-recado-aberto");
      setTimeout(function () { fundo.remove(); }, 180);
      document.removeEventListener("keydown", tecla);
      if (anterior && anterior.focus) try { anterior.focus(); } catch (e) { /* ok */ }
    }
    function tecla(e) {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight" && i < n - 1) { i++; desenha(); foco(); }
      if (e.key === "ArrowLeft" && i > 0) { i--; desenha(); foco(); }
    }
    fundo.addEventListener("click", function (e) { if (e.target === fundo) fechar(); });
    document.addEventListener("keydown", tecla);
    desenha();
    foco();
  }

  function carregar() {
    return fetch("/api/recado", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        recados = d && Array.isArray(d.recados) ? d.recados : d && d.ativo ? [d] : [];
        window.dispatchEvent(new CustomEvent("vv-recado", { detail: recados.length > 0 }));
        return recados;
      })
      .catch(function () { return []; });
  }

  window.vvRecado = {
    tem: function () { return recados.length > 0; },
    total: function () { return recados.length; },
    abrir: function () { mostrar(recados, false); },
    // previa(recado) ou previa([recado, ...])
    previa: function (r) { mostrar(Array.isArray(r) ? r : [r], true); },
  };

  carregar().then(function (lista) {
    if (!lista.length || semAuto) return;
    var vistos = lerVistos();
    var mostrar_ = lista.filter(function (r) { return deveMostrar(r, vistos); });
    if (!mostrar_.length) return;
    // espera a página assentar um pouco antes de abrir (e, no Início, a mensagem de boas-vindas sair)
    var abre = function () { setTimeout(function () { if (!document.body.classList.contains("present")) mostrar(mostrar_, false); }, 600); };
    if (document.documentElement.classList.contains("vv-bv")) window.addEventListener("vv-bv-fim", abre, { once: true });
    else abre();
  });
})();
