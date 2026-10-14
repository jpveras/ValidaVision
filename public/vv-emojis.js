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
