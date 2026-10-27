// Service worker do Toca dos Bug Hunters: permite instalar como app e receber o lembrete de sexta.
// De propósito, NÃO guarda páginas em cache (evita mostrar versão antiga); só uma tela simples offline.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sem conexão · Toca dos Bug Hunters</title><body style="font-family:system-ui,sans-serif;background:#eef1f0;color:#0b3b47;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><div style="font-size:42px">📶</div><h1 style="font-weight:500">Sem conexão</h1><p>Conecte-se à internet e tente de novo.</p>
<button onclick="location.reload()" style="background:#109c8a;color:#fff;border:0;border-radius:6px;padding:12px 18px;font-size:15px">Tentar de novo</button></div></body>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const titulo = d.title || "Toca dos Bug Hunters";
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: d.body || "Como foi a sua semana?",
      icon: "/icon-192.png?v=4",
      badge: "/icon-192.png?v=4",
      tag: d.tag || "vv-lembrete",
      data: { url: d.url || "/sentimento.html" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/sentimento.html", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const c of lista) if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
