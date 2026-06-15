/**
 * SIRAL — agenda Google, Outlook / Microsoft 365 ou iCloud (lecture seule via flux iCal).
 * Les adresses secrètes .ics sont stockées sur l'appareil (prefs) ; la récupération
 * passe par le proxy serveur /api/agenda, strictement limité à une liste blanche
 * d'hôtes (Google + Outlook + iCloud).
 *
 * On peut connecter PLUSIEURS agendas en même temps (un par fournisseur) : leurs
 * événements sont fusionnés dans un même calendrier sur le tableau de bord.
 */
import { ElectronBridge } from '@/utils/electronBridge';

/** Ancienne clé — un seul agenda. Conservée pour la migration / compatibilité. */
export const AGENDA_ICAL_KEY = 'agenda_ical_url';
/** Nouvelle clé — un agenda par fournisseur (Google / Outlook / iCloud). */
export const AGENDA_ICAL_URLS_KEY = 'agenda_ical_urls';

export type AgendaSource = 'google' | 'outlook' | 'icloud' | 'other';

export interface AgendaUrls {
  google?: string;
  outlook?: string;
  icloud?: string;
}

export interface AgendaEvent {
  title: string;
  start: string;   // ISO
  allDay: boolean;
  source?: AgendaSource;
}

/** Couleur d'affichage par fournisseur (pastilles du calendrier). */
export const SOURCE_META: Record<AgendaSource, { label: string; color: string }> = {
  google: { label: 'Google', color: '#4285F4' },
  outlook: { label: 'Outlook', color: '#0F6CBD' },
  icloud: { label: 'iCloud', color: '#E8554E' },
  other: { label: 'Agenda', color: '#6366F1' },
};

/** Clé de stockage des préférences d'affichage du calendrier. */
export const AGENDA_DISPLAY_KEY = 'agenda_display_settings';

export type AgendaEventSize = 'small' | 'medium' | 'large';

export interface AgendaDisplaySettings {
  eventSize: AgendaEventSize;
  colors: Partial<Record<AgendaSource, string>>;
}

export const DEFAULT_DISPLAY: AgendaDisplaySettings = { eventSize: 'small', colors: {} };

export async function loadAgendaDisplay(): Promise<AgendaDisplaySettings> {
  const s = await ElectronBridge.getData<AgendaDisplaySettings | null>(AGENDA_DISPLAY_KEY, null);
  if (!s) return DEFAULT_DISPLAY;
  return { ...DEFAULT_DISPLAY, ...s, colors: { ...DEFAULT_DISPLAY.colors, ...(s.colors ?? {}) } };
}

export async function saveAgendaDisplay(settings: AgendaDisplaySettings): Promise<void> {
  await ElectronBridge.setData(AGENDA_DISPLAY_KEY, settings);
}

/** Déduit le fournisseur à partir de l'hôte de l'URL iCal. */
export function sourceFromUrl(url: string): AgendaSource {
  const u = (url || '').toLowerCase();
  if (u.includes('calendar.google.com')) return 'google';
  if (u.includes('outlook.')) return 'outlook';
  if (u.includes('icloud.com')) return 'icloud';
  return 'other';
}

/** Récupère un seul flux iCal via le proxy serveur (lecture seule). */
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

/**
 * Récupère plusieurs agendas en parallèle et fusionne leurs événements,
 * chacun étiqueté par son fournisseur. Les flux en échec sont ignorés
 * silencieusement pour ne pas masquer les autres.
 */
export async function fetchAgendaMulti(urls: AgendaUrls): Promise<AgendaEvent[]> {
  const entries = (Object.entries(urls) as Array<[AgendaSource, string | undefined]>)
    .filter(([, u]) => u && u.trim());
  const results = await Promise.all(entries.map(async ([source, u]) => {
    try {
      const ev = await fetchAgenda((u as string).trim());
      return ev.map(e => ({ ...e, source }));
    } catch {
      return [] as AgendaEvent[];
    }
  }));
  return results.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Lit les agendas enregistrés sur l'appareil. Migre automatiquement l'ancienne
 * clé « un seul agenda » vers la nouvelle structure (en déduisant le fournisseur).
 */
export async function loadAgendaUrls(): Promise<AgendaUrls> {
  const stored = await ElectronBridge.getData<AgendaUrls | null>(AGENDA_ICAL_URLS_KEY, null);
  if (stored && typeof stored === 'object') {
    const { google, outlook, icloud } = stored;
    if (google || outlook || icloud) return { google, outlook, icloud };
  }
  // Migration depuis l'ancienne clé unique.
  const legacy = String(await ElectronBridge.getData(AGENDA_ICAL_KEY, '') || '');
  if (legacy) {
    const src = sourceFromUrl(legacy);
    const migrated: AgendaUrls = src === 'outlook' ? { outlook: legacy }
      : src === 'icloud' ? { icloud: legacy }
      : { google: legacy };
    return migrated;
  }
  return {};
}

/** Enregistre les agendas sur l'appareil (et nettoie l'ancienne clé unique). */
export async function saveAgendaUrls(urls: AgendaUrls): Promise<void> {
  const clean: AgendaUrls = {};
  if (urls.google?.trim()) clean.google = urls.google.trim();
  if (urls.outlook?.trim()) clean.outlook = urls.outlook.trim();
  if (urls.icloud?.trim()) clean.icloud = urls.icloud.trim();
  await ElectronBridge.setData(AGENDA_ICAL_URLS_KEY, clean);
  // L'ancienne clé n'a plus de rôle dès qu'on utilise la nouvelle structure.
  await ElectronBridge.setData(AGENDA_ICAL_KEY, '');
}
