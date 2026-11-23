'use client';

// Colonne des tâches OCR du convertisseur (gestionnaire : useOcrJobsStore).
// Une carte par tâche : avancement, temps restant (file comprise), détail
// dépliable PDF par PDF, téléchargement de ce qui est lu, arrêt / retrait.
// En tête : la charge du service OCR.

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Download, Trash2, StopCircle, Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, ScanLine,
} from 'lucide-react';
import { useOcrJobsStore, pagesAvantFin, type TacheOcr, type FichierOcr } from '@/stores/useOcrJobsStore';

const VERT = '#2B5746';
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
export const duree = (s: number) => (s < 60 ? 'moins d’une minute'
  : s < 3600 ? `environ ${Math.ceil(s / 60)} min`
  : `environ ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const heure = (t?: number) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

const STATUT: Record<TacheOcr['statut'], { lib: string, cls: string }> = {
  attente: { lib: 'En file', cls: 'bg-gray-100 text-gray-600' },
  encours: { lib: 'En cours', cls: 'bg-[#2B5746]/10 text-[#2B5746]' },
  terminee: { lib: 'Terminé', cls: 'bg-emerald-50 text-emerald-700' },
  arretee: { lib: 'Arrêté', cls: 'bg-amber-50 text-amber-700' },
};

function IconeFichier({ f }: { f: FichierOcr }) {
  if (f.statut === 'encours') return <Loader2 className="h-3 w-3 animate-spin shrink-0" style={{ color: VERT }} />;
  if (f.statut === 'fait') return <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />;
  if (f.statut === 'partiel') return <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />;
  if (f.statut === 'echec') return <XCircle className="h-3 w-3 text-red-500 shrink-0" />;
  return <Clock className="h-3 w-3 text-gray-300 shrink-0" />;
}

function Carte({ t }: { t: TacheOcr }) {
  const [ouvert, setOuvert] = useState(false);
  const taches = useOcrJobsStore(s => s.taches);
  const sParPage = useOcrJobsStore(s => s.secondesParPage);
  const { arreter, retirer, telecharger } = useOcrJobsStore.getState();
  const actif = t.statut === 'encours' || t.statut === 'attente';
  const pct = Math.round((t.faites / Math.max(1, t.total)) * 100);
  const echecs = t.fichiers.filter(f => f.statut === 'echec').length;
  const partiels = t.fichiers.filter(f => f.statut === 'partiel').length;
  const nonLances = actif ? 0 : t.fichiers.filter(f => f.statut === 'attente').length;

  function supprimer() {
    if (actif) {
      if (window.confirm('Arrêter cette tâche OCR ? Les pages déjà lues sont conservées et restent téléchargeables.')) arreter(t.id);
    } else if (window.confirm('Retirer cette tâche de la liste ? Ses résultats ne seront plus téléchargeables.')) {
      retirer(t.id);
    }
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="px-3 pt-3 pb-2.5 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate" title={t.nom}>{t.nom}</p>
            <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUT[t.statut].cls}`}>{STATUT[t.statut].lib}</span>
          </div>
          <button title="Télécharger ce qui est déjà lu (ZIP)" onClick={() => telecharger(t.id)}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"><Download className="h-4 w-4" /></button>
          <button title={actif ? 'Arrêter (les pages lues sont conservées)' : 'Retirer de la liste'} onClick={supprimer}
            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
            {actif ? <StopCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>

        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: t.statut === 'arretee' ? '#d97706' : VERT }} />
        </div>
        <p className="text-[11px] text-gray-500 tabular-nums">
          {t.faites} / {pluriel(t.total, 'page')}
          {actif && <> · reste {duree(pagesAvantFin(taches, t.id) * sParPage)}</>}
          {t.statut === 'terminee' && <> · fini à {heure(t.fin)}</>}
          {t.statut === 'arretee' && <> · arrêté à {heure(t.fin)}</>}
        </p>
        {(echecs > 0 || partiels > 0 || nonLances > 0) && !actif && (
          <p className="text-[11px] text-amber-700">
            {[
              partiels ? `${pluriel(partiels, 'PDF')} incomplet${partiels > 1 ? 's' : ''}` : '',
              nonLances ? `${nonLances} non lancé${nonLances > 1 ? 's' : ''}` : '',
              echecs ? `${echecs} en échec` : '',
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <button onClick={() => setOuvert(o => !o)}
        className="w-full flex items-center gap-1 px-3 py-1.5 border-t text-[11px] text-gray-500 hover:bg-gray-50">
        {ouvert ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Détail · {pluriel(t.fichiers.length, 'PDF')}
      </button>
      {ouvert && (
        <ul className="px-3 pb-2 space-y-1 max-h-64 overflow-auto">
          {t.fichiers.map(f => (
            <li key={f.chemin} className="flex items-center gap-1.5 text-[11px]" title={f.erreur ? `${f.chemin}\n${f.erreur}` : f.chemin}>
              <IconeFichier f={f} />
              <span className="truncate flex-1 text-gray-700">{f.chemin.split('/').pop()}</span>
              <span className="tabular-nums text-gray-400 shrink-0">{f.faites}/{f.pages}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const ColonneOcr: React.FC = () => {
  const taches = useOcrJobsStore(s => s.taches);
  const service = useOcrJobsStore(s => s.service);
  const sParPage = useOcrJobsStore(s => s.secondesParPage);
  const actives = taches.some(t => t.statut === 'encours' || t.statut === 'attente');

  return (
    <aside className="w-full lg:w-72 shrink-0 space-y-3 lg:sticky lg:top-4">
      <div className="flex items-center gap-1.5">
        <ScanLine className="h-4 w-4" style={{ color: VERT }} />
        <p className="text-sm font-bold text-gray-900">Tâches OCR</p>
      </div>
      <div className="rounded-lg border bg-gray-50 px-3 py-2 text-[11px] text-gray-600 space-y-0.5">
        <p className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${!service || service.etat !== 'pret' ? 'bg-red-400' : service.occupe ? 'bg-amber-400' : 'bg-emerald-500'}`} />
          Service OCR : {!service ? '…' : service.etat !== 'pret' ? 'indisponible'
            : service.occupe ? `occupé${service.enAttente ? ` · ${pluriel(service.enAttente, 'requête')} en file` : ''}` : 'libre'}
        </p>
        {actives && <p className="text-gray-400">Vitesse : environ {sParPage.toFixed(1).replace('.', ',')} s par page</p>}
      </div>
      {/* en cours, puis la file dans l'ordre, puis les tâches finies (récentes d'abord) */}
      {[
        ...taches.filter(t => t.statut === 'encours' || t.statut === 'attente'),
        ...taches.filter(t => t.statut === 'terminee' || t.statut === 'arretee').reverse(),
      ].map(t => <Carte key={t.id} t={t} />)}
    </aside>
  );
};
