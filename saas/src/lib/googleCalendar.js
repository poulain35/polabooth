const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_KEY = 'gc_token';
const TOKEN_EXP_KEY = 'gc_token_exp';

let _token = sessionStorage.getItem(TOKEN_KEY);

export function isGoogleConnected() {
  const exp = parseInt(sessionStorage.getItem(TOKEN_EXP_KEY) ?? '0', 10);
  if (!_token || Date.now() > exp) {
    _token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    return false;
  }
  return true;
}

function loadGIS() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

export async function connectGoogle() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré dans .env');
  await loadGIS();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback(response) {
        if (response.error) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        _token = response.access_token;
        const exp = Date.now() + (response.expires_in - 60) * 1000;
        sessionStorage.setItem(TOKEN_KEY, _token);
        sessionStorage.setItem(TOKEN_EXP_KEY, String(exp));
        resolve();
      },
    });
    client.requestAccessToken();
  });
}

export async function disconnectGoogle() {
  if (_token) {
    try {
      await loadGIS();
      window.google?.accounts?.oauth2?.revoke(_token, () => {});
    } catch { /* ignore */ }
  }
  _token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXP_KEY);
}

async function gcFetch(path, options = {}) {
  if (!_token) throw new Error('Non connecté à Google Agenda');
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${_token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    _token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    throw new Error('Session Google expirée — reconnectez-vous.');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Erreur Google ${res.status}`);
  return data;
}

export async function fetchGoogleEvents(timeMin, timeMax, calendarId = 'primary') {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '500',
  });
  const data = await gcFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return (data?.items ?? []).filter(e => e.status !== 'cancelled');
}

// Convertit une datetime locale ("YYYY-MM-DDTHH:MM") en format Google Calendar
// (sans conversion UTC, pour que timeZone soit respecté côté Google)
function toGcDateTime(dt) {
  if (!dt) return dt;
  return dt.length === 16 ? dt + ':00' : dt; // assure les secondes
}

function toGcEvent(entry) {
  return {
    summary: entry.title,
    ...(entry.notes ? { description: entry.notes } : {}),
    start: { dateTime: toGcDateTime(entry.startAt), timeZone: 'Europe/Paris' },
    end:   { dateTime: toGcDateTime(entry.endAt),   timeZone: 'Europe/Paris' },
  };
}

export async function createGoogleEvent(entry, calendarId = 'primary') {
  const data = await gcFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toGcEvent(entry)),
  });
  return data.id;
}

export async function updateGoogleEvent(googleEventId, entry, calendarId = 'primary') {
  await gcFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`, {
    method: 'PATCH',
    body: JSON.stringify(toGcEvent(entry)),
  });
}

export async function deleteGoogleEvent(googleEventId, calendarId = 'primary') {
  await gcFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`, {
    method: 'DELETE',
  });
}
