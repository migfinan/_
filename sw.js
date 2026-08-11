/* ══════════ MIG Finance — Service Worker ══════════
   1. Cache básico do app shell pra abrir offline com os últimos dados
      (os dados em si já vivem no localStorage/Firebase — o SW só
      garante que o HTML/ícones/manifest carreguem sem rede).
   2. Notificações nativas (lembretes de agenda), disparadas pelo
      próprio app via showNotification() — sem servidor de push.
*/

const CACHE_VERSION = 'mig-finance-v1';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((e) => console.warn('SW install: falha ao cachear shell', e))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Estratégia: stale-while-revalidate pro próprio site (HTML, ícones,
   manifest, fontes/CDNs). Chamadas a APIs externas de dados (Firebase,
   Claude, Pluggy, cotações etc.) NUNCA passam pelo cache, pra nunca
   mostrar saldo/cotação desatualizados sem o usuário saber. */
const NO_CACHE_HOSTS = [
  'api.anthropic.com',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'api.pluggy.ai',
  'cdn.pluggy.ai',
  'open.er-api.com',
  'brapi.dev',
  'api.coingecko.com',
  'economia.awesomeapi.com.br',
  'api.emailjs.com'
];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NO_CACHE_HOSTS.some((h) => url.hostname.includes(h))) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* ── Clique na notificação: foca a aba já aberta (e avisa o app pra
   navegar até a Agenda) ou abre o app se estiver fechado. ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.postMessage({ type: 'NAV_CALENDAR' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./index.html');
      }
    })
  );
});

/* ── Suporte a push real via servidor (VAPID), caso um backend seja
   adicionado no futuro. Sem servidor configurado, este evento nunca
   dispara — os lembretes atuais são 100% locais (sem custo). ── */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'MIG Finance';
  const options = {
    body: data.body || 'Você tem uma atualização financeira.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [100, 50, 100],
    data: data.data || {}
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
