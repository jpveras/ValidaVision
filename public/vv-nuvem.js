// Nuvem de palavras compartilhada pelas telas do Sentimento da Semana.
// palavras: [[palavra, quantidade], ...] já ordenado do maior para o menor.
(function () {
  const CORES = ['#0b7f70', '#109c8a', '#033a45', '#2fc28f', '#c98a12', '#0b3b47', '#1a8f6a', '#d0811b'];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  window.vvNuvem = function (box, canvas, fallback, palavras) {
    if (!palavras || !palavras.length) { canvas.hidden = true; fallback.hidden = true; return; }
    const W = box.clientWidth, H = box.clientHeight;
    const max = palavras[0][1], min = palavras[palavras.length - 1][1];
    const maxPx = Math.max(34, Math.min(W, H) / (palavras.length < 6 ? 3 : 4.4)), minPx = Math.max(14, maxPx / 5);
    const tam = (c) => (max === min ? maxPx * 0.75 : minPx + ((c - min) / (max - min)) * (maxPx - minPx));
    const cor = (w, c) => CORES[(w.length + c) % CORES.length];
    if (window.WordCloud && WordCloud.isSupported) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.hidden = false; fallback.hidden = true;
      WordCloud(canvas, {
        list: palavras, weightFactor: (c) => tam(c) * dpr, fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif', fontWeight: '700',
        color: cor, rotateRatio: 0.15, rotationSteps: 2, gridSize: Math.round(8 * dpr), backgroundColor: 'rgba(0,0,0,0)',
        shrinkToFit: true, drawOutOfBound: false, shuffle: false,
      });
    } else {
      canvas.hidden = true; fallback.hidden = false;
      fallback.innerHTML = palavras.map(([w, c]) => `<span style="font-size:${tam(c).toFixed(0)}px;color:${cor(w, c)}">${esc(w)}</span>`).join('');
    }
  };
})();
