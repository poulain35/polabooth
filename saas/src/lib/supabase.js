// Point d'entrée unique de l'API Supabase du front : le client partagé et les fonctions par domaine,
// rangées dans lib/api/. Les imports existants (`@/lib/supabase`, `../lib/supabase`) restent valables.
export * from './api/client.js';
export * from './api/designs.js';
export * from './api/support.js';
export * from './api/library.js';
export * from './api/forms.js';
export * from './api/settings.js';
export * from './api/emails.js';
export * from './api/events.js';
export * from './api/photos.js';
export * from './api/kioskConfig.js';
export * from './api/kiosks.js';
export * from './api/kioskLogs.js';
export * from './api/planning.js';
export * from './api/guestResponses.js';
export * from './api/eventReports.js';
export * from './api/kioskScreens.js';
export * from './api/equipment.js';
export * from './api/pola.js';
export * from './api/notifications.js';
export * from './api/auth.js';
