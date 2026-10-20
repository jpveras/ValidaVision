// Fileira de emojis para o campo do elogio.
// Uso: vvEmojis(textarea) — cria os botões logo abaixo do campo.
// Um toque insere o emoji onde está o cursor (ou no fim), respeitando o maxlength,
// e dispara "input" para o contador atualizar.
(function () {
  const EMOJIS = [
    ["💚", "coração verde"], ["❤️", "coração"], ["👏", "palmas"], ["🙌", "comemorando"],
    ["🚀", "foguete"], ["⭐", "estrela"], ["🏆", "troféu"], ["💪", "força"],
    ["🎉", "festa"], ["😊", "sorriso"], ["🙏", "obrigado"], ["🤝", "parceria"],
    ["💡", "ideia"], ["🔥", "mandou bem"], ["✨", "brilho"], ["👍", "joinha"],
  ];

  const css = `
.vv-emojis{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 2px}
.vv-emojis button{width:38px;height:38px;border-radius:10px;border:1px solid var(--line,#d9e2e1);background:#fff;
  font-size:20px;line-height:1;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;
  transition:transform .08s,background .15s,border-color .15s;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
.vv-emojis button:hover{background:var(--teal-soft,#e6f5f2);border-color:var(--teal2,#0b7f70)}
.vv-emojis button:active{transform:scale(.9)}
.vv-emojis button:focus-visible{outline:2px solid var(--teal2,#0b7f70);outline-offset:1px}
@media(max-width:420px){.vv-emojis{gap:3px}.vv-emojis button{width:34px;height:34px;font-size:18px}}`;

  function estilo() {
    if (document.getElementById("vv-emojis-css")) return;
    const s = document.createElement("style");
    s.id = "vv-emojis-css";
    s.textContent = css;
    document.head.appendChild(s);
  }

  window.vvEmojis = function (campo) {
    if (!campo || campo.dataset.vvEmojis) return;
    campo.dataset.vvEmojis = "1";
    estilo();
    const barra = document.createElement("div");
    barra.className = "vv-emojis";
    barra.setAttribute("role", "group");
    barra.setAttribute("aria-label", "Inserir emoji");
    for (const [e, nome] of EMOJIS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e;
      b.title = nome;
      b.setAttribute("aria-label", `Inserir ${nome}`);
      // Não tira o foco do campo (no celular o teclado não fica abrindo e fechando).
      b.addEventListener("mousedown", (ev) => ev.preventDefault());
      b.addEventListener("click", () => inserir(campo, e));
      barra.appendChild(b);
    }
    campo.insertAdjacentElement("afterend", barra);
  };

  // Tags prontas para o elogio (Elogie um Colega): um toque e a frase entra no campo.
  const TAGS = [
    "Mandou muito bem! 👏", "Salvou a sprint 🚀", "Parceria total 🤝", "Achou um bug crítico 🐞",
    "Sempre disposto(a) a ajudar 🙌", "Testes impecáveis ✅", "Comunicação clara 💬",
    "Muito organizado(a) 📋", "Atenção aos detalhes 🔍", "Energia contagiante ✨",
  ];
  const cssTags = `
.vv-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}
.vv-tags-tit{width:100%;font-size:12px;color:var(--muted,#6b7a80);margin:0 0 2px}
.vv-tags button{height:auto;min-height:32px;padding:5px 12px;border-radius:99px;border:1px solid var(--line,#d9e2e1);background:#fff;color:var(--text,#25343a);
  font:inherit;font-size:13px;font-weight:500;text-transform:none;letter-spacing:normal;cursor:pointer;line-height:1.25;white-space:normal;text-align:left;transition:background .15s,border-color .15s}
.vv-tags button:hover{background:var(--teal-soft,#e6f5f2);border-color:var(--teal2,#0b7f70)}
.vv-tags button.usada{background:var(--teal-soft,#e6f5f2);border-color:var(--teal2,#0b7f70);color:var(--teal2,#0b7f70)}
@media(max-width:520px){.vv-tags{gap:5px}.vv-tags button{font-size:12px;padding:4px 10px;min-height:30px}}
.vv-tags button:focus-visible{outline:2px solid var(--teal2,#0b7f70);outline-offset:1px}
@media screen{html[data-tema="escuro"] .vv-tags button{background:var(--card);border-color:var(--line);color:var(--ink)}
html[data-tema="escuro"] .vv-tags button.usada,html[data-tema="escuro"] .vv-tags button:hover{background:var(--teal-soft);border-color:var(--teal);color:var(--ink)}}`;
  window.vvTags = function (campo) {
    if (!campo || campo.dataset.vvTags) return;
    campo.dataset.vvTags = "1";
    if (!document.getElementById("vv-tags-css")) {
      const s = document.createElement("style");
      s.id = "vv-tags-css";
      s.textContent = cssTags;
      document.head.appendChild(s);
    }
    const barra = document.createElement("div");
    barra.className = "vv-tags";
    barra.setAttribute("role", "group");
    barra.setAttribute("aria-label", "Frases prontas para o elogio");
    barra.innerHTML = '<p class="vv-tags-tit">Sem tempo de escrever? Toque numa ou mais frases:</p>';
    for (const t of TAGS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.addEventListener("mousedown", (ev) => ev.preventDefault());
      b.addEventListener("click", () => {
        const v = campo.value.trim();
        if (v.includes(t)) return;
        const novo = v ? v + " " + t : t;
        const max = Number(campo.getAttribute("maxlength")) || Infinity;
        if (novo.length > max) {
          campo.classList.add("vv-cheio");
          setTimeout(() => campo.classList.remove("vv-cheio"), 600);
          return;
        }
        campo.value = novo;
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      barra.appendChild(b);
    }
    const marcar = () => barra.querySelectorAll("button").forEach((b) => b.classList.toggle("usada", campo.value.includes(b.textContent)));
    campo.addEventListener("input", marcar);
    campo.form?.addEventListener("reset", () => setTimeout(marcar, 0));
    campo.insertAdjacentElement("beforebegin", barra);
  };

  function inserir(campo, emoji) {
    const max = Number(campo.getAttribute("maxlength")) || Infinity;
    const v = campo.value;
    const ini = campo.selectionStart ?? v.length;
    const fim = campo.selectionEnd ?? v.length;
    // Espaço antes, se colado numa palavra.
    const antes = ini > 0 && !/\s/.test(v[ini - 1]) ? " " : "";
    const pedaco = antes + emoji;
    if (v.length - (fim - ini) + pedaco.length > max) {
      campo.classList.add("vv-cheio");
      setTimeout(() => campo.classList.remove("vv-cheio"), 600);
      return;
    }
    campo.value = v.slice(0, ini) + pedaco + v.slice(fim);
    const pos = ini + pedaco.length;
    try { campo.setSelectionRange(pos, pos); } catch { /* ok */ }
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }
})();
