'use client';

/**
 * Paramètres → Agenda : connexion d'un calendrier Google en LECTURE SEULE
 * via son adresse secrète au format iCal. Aucun accès au compte Google,
 * aucun jeton : juste un flux .ics que vous pouvez révoquer à tout moment
 * depuis Google Agenda. L'adresse est stockée sur cet appareil (chiffré).
 */
import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ElectronBridge } from '@/utils/electronBridge';
import { AGENDA_ICAL_KEY, fetchAgenda, AgendaEvent } from '@/lib/web/agenda';

export const AgendaPanel = () => {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<AgendaEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { ElectronBridge.getData(AGENDA_ICAL_KEY, '').then(v => setUrl(String(v || ''))); }, []);

  const save = async () => {
    await ElectronBridge.setData(AGENDA_ICAL_KEY, url.trim());
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTesting(true); setError(''); setPreview(null);
    try {
      const ev = await fetchAgenda(url.trim());
      setPreview(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec');
    } finally { setTesting(false); }
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-indigo-600" /> Agenda Google (lecture seule)
        </h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Affiche vos prochains rendez-vous sur le tableau de bord, à côté des échéances.
          SIRAL n&apos;accède jamais à votre compte Google : vous collez seulement
          l&apos;<b>adresse secrète au format iCal</b> de l&apos;agenda choisi. Vous pouvez la
          régénérer (donc la révoquer) à tout moment depuis Google&nbsp;Agenda.
        </p>
      </div>

      <ol className="text-[13px] text-gray-600 list-decimal pl-5 space-y-1">
        <li>Google Agenda → Paramètres de l&apos;agenda concerné.</li>
        <li>Section « Intégrer l&apos;agenda » → copiez l&apos;<b>adresse secrète au format iCal</b>.</li>
        <li>Collez-la ci-dessous (elle commence par <code>https://calendar.google.com/…/basic.ics</code>).</li>
      </ol>

      <div className="space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save}>{saved ? 'Enregistré ✓' : 'Enregistrer'}</Button>
          <Button size="sm" variant="outline" onClick={test} disabled={testing || !url.trim()}>
            {testing ? 'Test…' : 'Tester la connexion'}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setUrl(''); ElectronBridge.setData(AGENDA_ICAL_KEY, ''); setPreview(null); }}>
              Déconnecter
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}
      {preview && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <div className="flex items-center gap-1.5 font-semibold mb-1"><Check className="h-4 w-4" /> Connexion réussie — {preview.length} événement(s) à venir</div>
          <ul className="text-[12px] space-y-0.5 mt-1">
            {preview.slice(0, 4).map((e, i) => (
              <li key={i}>{new Date(e.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — {e.title}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-gray-400 leading-relaxed">
        Sécurité : la connexion est strictement limitée à <code>calendar.google.com</code> en HTTPS, en lecture seule.
        L&apos;adresse n&apos;est jamais journalisée sur le serveur.
      </p>
    </div>
  );
};
