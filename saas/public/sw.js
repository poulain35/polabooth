// Service worker minimal : présent pour rendre la galerie installable (« ajouter à
// l'écran d'accueil »). Pas de cache offline agressif — on laisse passer le réseau
// pour ne jamais servir de photos périmées.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough réseau */ });
