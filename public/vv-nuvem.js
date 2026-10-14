// Nuvem de palavras compartilhada pelas telas do Sentimento da Semana.
// palavras: [[palavra, quantidade], ...] já ordenado do maior para o menor.
(function () {
  const CLARO = ['#0b7f70', '#109c8a', '#033a45', '#2fc28f', '#c98a12', '#0b3b47', '#1a8f6a', '#d0811b'];
  // No modo escuro, as mesmas famílias de cor, mais claras (as escuras sumiriam no fundo).
  const ESCURO = ['#3fd1b8','#2fc28f','#8fe0d2','#5ee0a6','#f0b54a','#cfe9e4','#46b8a6','#f39a4a'];
  const paleta = () => (window.vvTema && vvTema.escuro() ? ESCURO : CLARO);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  window.vvNuvem = function (box, canvas, fallback, palavras) {
    if (!palavras || !palavras.length) { canvas.hidden = true; fallback.hidden = true; return; }
    // Margem de segurança nas bordas: no celular as palavras encostavam e eram cortadas.
    const M = box.clientWidth < 520 ? 12 : 8;
    const W = Math.max(120, box.clientWidth - 2 * M), H = Math.max(120, box.clientHeight - 2 * M);
    const max = palavras[0][1], min = palavras[palavras.length - 1][1];
    // Tela estreita (celular): letras um pouco menores para todas as palavras caberem sem cortar.
    const estreita = W < 520;
    const maxPx = Math.max(30, Math.min(W, H) / (palavras.length < 6 ? 3 : estreita ? 5.6 : 4.4)), minPx = Math.max(estreita ? 12 : 14, maxPx / 5);
    const tam = (c) => (max === min ? maxPx * 0.75 : minPx + ((c - min) / (max - min)) * (maxPx - minPx));
    const CORES = paleta();
    const cor = (w, c) => CORES[(w.length + c) % CORES.length];
    if (window.WordCloud && WordCloud.isSupported) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.hidden = false; fallback.hidden = true;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; canvas.style.margin = M + 'px auto';
      const desenhar = () => WordCloud(canvas, {
        list: palavras, weightFactor: (c) => tam(c) * dpr, fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif', fontWeight: '700',
        color: cor, rotateRatio: estreita ? 0 : 0.15, rotationSteps: 2, gridSize: Math.round(8 * dpr), backgroundColor: 'rgba(0,0,0,0)',
        shrinkToFit: true, drawOutOfBound: false, shuffle: false,
      });
      // Mede as palavras com a fonte certa (Roboto) já carregada.
      // (a fonte em negrito só baixa quando é usada; sem isso a medida sai com outra fonte e corta nas bordas).
      if (document.fonts && document.fonts.load) {
        Promise.race([document.fonts.load('700 40px Roboto'), new Promise((r) => setTimeout(r, 1500))]).then(desenhar, desenhar);
      } else desenhar();
    } else {
      canvas.hidden = true; fallback.hidden = false;
      fallback.innerHTML = palavras.map(([w, c]) => `<span style="font-size:${tam(c).toFixed(0)}px;color:${cor(w, c)}">${esc(w)}</span>`).join('');
    }
  };
})();
