/**
 * SIRAL — agenda Google, Outlook / Microsoft 365 ou iCloud (lecture seule via flux iCal).
 * L'adresse secrète .ics est stockée sur l'appareil (prefs) ; la récupération
 * passe par le proxy serveur /api/agenda, strictement limité à une liste blanche
 * d'hôtes (Google + Outlook + iCloud).
 */
export const AGENDA_ICAL_KEY = 'agenda_ical_url';

export interface AgendaEvent {
  title: string;
  start: string;   // ISO
  allDay: boolean;
}

export async function fetchAgenda(url: string): Promise<AgendaEvent[]> {
  if (!url) return [];
  const res = await fetch('/api/agenda', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Agenda indisponible');
  return (data.events || []) as AgendaEvent[];
}
