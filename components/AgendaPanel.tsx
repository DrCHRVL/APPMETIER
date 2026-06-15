'use client';

/**
 * Paramètres → Agenda : connexion de PLUSIEURS calendriers (Google Agenda,
 * Outlook / Microsoft 365 et iCloud / Apple) en LECTURE SEULE via leur adresse
 * secrète au format iCal. Aucun accès au compte, aucun jeton : juste des flux
 * .ics que vous pouvez révoquer à tout moment. Les adresses sont stockées sur
 * cet appareil (chiffré). Leurs événements sont fusionnés dans le même
 * calendrier du tableau de bord.
 */
import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AgendaUrls, AgendaSource, AgendaEvent, AgendaDisplaySettings,
  fetchAgendaMulti, loadAgendaUrls, saveAgendaUrls,
  loadAgendaDisplay, saveAgendaDisplay,
  SOURCE_META,
} from '@/lib/web/agenda';

type ProviderKey = 'google' | 'outlook' | 'icloud';

const PROVIDERS: Array<{
  key: ProviderKey;
  title: string;
  placeholder: string;
  steps: React.ReactNode;
}> = [
  {
    key: 'google',
    title: 'Google Agenda',
    placeholder: 'https://calendar.google.com/…/basic.ics',
    steps: (
      <ol className="list-decimal pl-5 space-y-0.5 mt-0.5">
        <li>Google Agenda → Paramètres de l&apos;agenda concerné.</li>
        <li>Section « Intégrer l&apos;agenda » → copiez l&apos;<b>adresse secrète au format iCal</b>.</li>
        <li>Elle commence par <code>https://calendar.google.com/…/basic.ics</code>.</li>
      </ol>
    ),
  },
  {
    key: 'outlook',
    title: 'Outlook / Microsoft 365',
    placeholder: 'https://outlook.office365.com/…/calendar.ics',
    steps: (
      <ol className="list-decimal pl-5 space-y-0.5 mt-0.5">
        <li>Outlook → Paramètres → Calendrier → <b>Calendriers partagés</b>.</li>
        <li>Section « Publier un calendrier » → publiez-le, puis copiez le lien <b>ICS</b>.</li>
        <li>Elle commence par <code>https://outlook.office365.com/…/calendar.ics</code> (ou <code>outlook.live.com</code>).</li>
      </ol>
    ),
  },
  {
    key: 'icloud',
    title: 'iCloud (Apple)',
    placeholder: 'webcal://p52-caldav.icloud.com/…',
    steps: (
      <ol className="list-decimal pl-5 space-y-0.5 mt-0.5">
        <li>Sur Mac : app Calendrier → clic droit sur l&apos;agenda → <b>Partager l&apos;agenda</b> → cochez <b>Calendrier public</b>.<br />Sur iPhone : Calendrier → ⓘ à côté de l&apos;agenda → activez <b>Calendrier public</b>.</li>
        <li>Copiez le lien proposé (il commence par <code>webcal://</code> — collez-le tel quel).</li>
        <li>L&apos;hôte est de la forme <code>p52-caldav.icloud.com</code>.</li>
      </ol>
    ),
  },
];

const ALL_SOURCES: AgendaSource[] = ['google', 'outlook', 'icloud', 'other'];

export const AgendaPanel = () => {
  const [urls, setUrls] = useState<AgendaUrls>({});
  const [display, setDisplay] = useState<AgendaDisplaySettings>({ eventSize: 'small', colors: {} });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<AgendaEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAgendaUrls().then(setUrls);
    loadAgendaDisplay().then(setDisplay);
  }, []);

  const setUrl = (key: ProviderKey, value: string) =>
    setUrls(prev => ({ ...prev, [key]: value }));

  const setColor = (source: AgendaSource, value: string) =>
    setDisplay(prev => ({ ...prev, colors: { ...prev.colors, [source]: value } }));

  const resetColor = (source: AgendaSource) =>
    setDisplay(prev => {
      const colors = { ...prev.colors };
      delete colors[source];
      return { ...prev, colors };
    });

  const hasAny = Boolean(urls.google?.trim() || urls.outlook?.trim() || urls.icloud?.trim());

  const save = async () => {
    await Promise.all([saveAgendaUrls(urls), saveAgendaDisplay(display)]);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTesting(true); setError(''); setPreview(null);
    try {
      const ev = await fetchAgendaMulti(urls);
      setPreview(ev);
      if (ev.length === 0) setError("Connexion établie mais aucun événement trouvé sur la période (mois en cours et à venir). Vérifiez que l'agenda contient des rendez-vous et que l'adresse iCal est la bonne.");
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec');
    } finally { setTesting(false); }
  };

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-indigo-600" /> Agendas Google, Outlook et iCloud (lecture seule)
        </h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Affiche vos rendez-vous dans le <b>calendrier mensuel</b> du tableau de bord.
          Vous pouvez connecter les trois à la fois : leurs événements sont fusionnés et
          colorés par fournisseur. SIRAL n&apos;accède jamais à votre compte : vous collez
          seulement l&apos;<b>adresse secrète au format iCal</b> de chaque agenda, que vous
          pouvez régénérer (donc révoquer) à tout moment.
        </p>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map(p => {
          const meta = SOURCE_META[p.key as AgendaSource];
          const customColor = display.colors[p.key as AgendaSource];
          const activeColor = customColor ?? meta.color;
          return (
            <div key={p.key} className="rounded-xl border border-gray-200 p-3 sm:p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeColor }} />
                <b className="text-[13px]">{p.title}</b>
              </div>
              <div className="text-[12px] text-gray-600">{p.steps}</div>
              <Input
                value={urls[p.key] ?? ''}
                onChange={(e) => setUrl(p.key, e.target.value)}
                placeholder={p.placeholder}
                className="font-mono text-xs"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save}>{saved ? 'Enregistré ✓' : 'Enregistrer'}</Button>
        <Button size="sm" variant="outline" onClick={test} disabled={testing || !hasAny}>
          {testing ? 'Test…' : 'Tester la connexion'}
        </Button>
        {hasAny && (
          <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { setUrls({}); await saveAgendaUrls({}); setPreview(null); setError(''); }}>
            Tout déconnecter
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
        </div>
      )}
      {preview && preview.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <div className="flex items-center gap-1.5 font-semibold mb-1"><Check className="h-4 w-4" /> Connexion réussie — {preview.length} événement(s)</div>
          <ul className="text-[12px] space-y-0.5 mt-1">
            {preview.slice(0, 5).map((e, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_META[e.source ?? 'other'].color }} />
                {new Date(e.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — {e.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Apparence du calendrier */}
      <div className="rounded-xl border border-gray-200 p-3 sm:p-4 space-y-4">
        <h4 className="text-[13px] font-semibold text-gray-800">Apparence du calendrier</h4>

        {/* Taille des événements */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-gray-600">Taille des événements</label>
          <div className="flex items-center gap-2">
            {(['small', 'medium', 'large'] as const).map(size => (
              <button
                key={size}
                onClick={() => setDisplay(prev => ({ ...prev, eventSize: size }))}
                className={`px-3 py-1 rounded-md text-[12px] border transition-all ${
                  display.eventSize === size
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {size === 'small' ? 'Petite' : size === 'medium' ? 'Moyenne' : 'Grande'}
              </button>
            ))}
          </div>
        </div>

        {/* Couleurs par calendrier */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-gray-600">Couleurs des calendriers</label>
          <div className="space-y-2">
            {ALL_SOURCES.map(source => {
              const meta = SOURCE_META[source];
              const customColor = display.colors[source];
              const activeColor = customColor ?? meta.color;
              return (
                <div key={source} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={activeColor}
                    onChange={e => setColor(source, e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border border-gray-200 p-0.5 bg-white"
                    title={`Couleur ${meta.label}`}
                  />
                  <span className="text-[12px] text-gray-700">{meta.label}</span>
                  {customColor && (
                    <button
                      onClick={() => resetColor(source)}
                      className="text-[11px] text-gray-400 hover:text-gray-600 underline"
                    >
                      Réinitialiser
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Sécurité : la connexion est strictement limitée à <code>calendar.google.com</code>, aux domaines
        Outlook (<code>outlook.office365.com</code>, <code>outlook.office.com</code>, <code>outlook.live.com</code>) et à
        iCloud (<code>p…-caldav.icloud.com</code>) en HTTPS, en lecture seule. Les adresses ne sont jamais
        journalisées sur le serveur.
      </p>
    </div>
  );
};
