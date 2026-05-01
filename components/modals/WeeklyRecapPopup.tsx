import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Enquete, AlertRule } from '@/types/interfaces';
import { Calendar, FileText, Clock, AlertTriangle, Gavel } from 'lucide-react';
import { getLastCR } from '@/utils/compteRenduUtils';
import type { DossierInstruction } from '@/types/instructionTypes';
import {
  getDMLsEnRetard,
  getJoursRestantsAvantFinDP,
  countDMLsEnAttente,
} from '@/utils/instructionUtils';

interface ContentieuxBucket {
  contentieuxId: string;
  contentieuxLabel: string;
  contentieuxColor?: string;
  enquetes: Enquete[];
}

interface WeeklyRecapPopupProps {
  isOpen: boolean;
  onClose: () => void;
  /** Une entrée par contentieux abonné. Peut être vide → popup "rien à signaler". */
  buckets: ContentieuxBucket[];
  alertRules: AlertRule[];
  /**
   * Dossiers d'instruction (si l'utilisateur s'est abonné au récap instruction).
   * Affiche un encart résumé avec DML en retard, fins DP imminentes, débats JLD.
   */
  instructionDossiers?: DossierInstruction[];
}

// Seuil "urgence rouge" : actes/écoutes/géoloc à <=2j, et enquêtes sans CR
// dépassant le seuil de 50% (c.-à-d. 1.5× crThreshold).
const RED_DAYS_LEFT = 2;
const RED_CR_OVERRUN_FACTOR = 1.5;

interface ActeItem {
  enqueteNumero: string;
  contentieuxLabel: string;
  category: string;
  daysLeft: number;
  key: string;
}
interface RelanceItem {
  enquete: Enquete;
  contentieuxLabel: string;
  days: number;
}

export const WeeklyRecapPopup = ({ isOpen, onClose, buckets, alertRules, instructionDossiers }: WeeklyRecapPopupProps) => {
  const today = new Date();

  const crRule = alertRules.find(r => r.type === 'cr_delay' && r.enabled);
  const acteRule = alertRules.find(r => r.type === 'acte_expiration' && r.enabled);
  const crThreshold = crRule?.threshold ?? 7;
  const acteThreshold = acteRule?.threshold ?? 7;
  const redCRThreshold = Math.ceil(crThreshold * RED_CR_OVERRUN_FACTOR);

  // Construction par bucket : on calcule les actes à échéance et les enquêtes
  // à relancer, en taguant chaque ligne avec le label du contentieux.
  const perContentieux = buckets.map(bucket => {
    const actes: ActeItem[] = bucket.enquetes
      .filter(e => e.statut === 'en_cours')
      .flatMap(e => {
        const list = [
          ...(e.actes || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Acte' })),
          ...(e.ecoutes || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Écoute' })),
          ...(e.geolocalisations || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Géoloc' })),
        ];
        return list;
      })
      .filter(a => a.statut === 'en_cours' && (a as any).dateFin)
      .map((a, idx) => {
        const daysLeft = Math.ceil((new Date((a as any).dateFin).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return {
          enqueteNumero: (a as any).enqueteNumero,
          contentieuxLabel: bucket.contentieuxLabel,
          category: (a as any).category,
          daysLeft,
          key: `${bucket.contentieuxId}-${(a as any).id ?? idx}`,
        };
      })
      .filter(a => a.daysLeft >= 0 && a.daysLeft <= acteThreshold)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const relances: RelanceItem[] = bucket.enquetes
      .filter(e => e.statut === 'en_cours' && e.comptesRendus.length > 0)
      .map(e => {
        const lastCR = getLastCR(e.comptesRendus);
        const days = Math.floor((today.getTime() - new Date(lastCR.date).getTime()) / (1000 * 60 * 60 * 24));
        return { enquete: e, contentieuxLabel: bucket.contentieuxLabel, days };
      })
      .filter(({ days }) => days >= crThreshold)
      .sort((a, b) => b.days - a.days);

    return { bucket, actes, relances };
  });

  // Urgences rouges : extraites de tous les contentieux confondus, triées par
  // criticité. Affichées en tête pour être vues immédiatement.
  const urgentActes = perContentieux
    .flatMap(p => p.actes)
    .filter(a => a.daysLeft <= RED_DAYS_LEFT)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const urgentRelances = perContentieux
    .flatMap(p => p.relances)
    .filter(r => r.days >= redCRThreshold)
    .sort((a, b) => b.days - a.days);

  const hasUrgent = urgentActes.length + urgentRelances.length > 0;
  const totalItems = perContentieux.reduce((acc, p) => acc + p.actes.length + p.relances.length, 0);
  const hasSubscriptions = buckets.length > 0 || (instructionDossiers && instructionDossiers.length > 0);

  // Résumé instruction (dossiers urgents)
  const instructionSummary = React.useMemo(() => {
    if (!instructionDossiers || instructionDossiers.length === 0) return null;
    const dpProches: { dossierLabel: string; mexNom: string; days: number }[] = [];
    const dmlsRetard: { dossierLabel: string; mexNom: string; joursRetard: number }[] = [];
    const debatsProches: { dossierLabel: string; type: string; days: number }[] = [];
    const todayMs = today.getTime();
    for (const d of instructionDossiers) {
      const label = d.numeroInstruction;
      for (const mex of d.misEnExamen) {
        if (mex.mesureSurete.type === 'detenu') {
          const j = getJoursRestantsAvantFinDP(mex);
          if (j !== null && j >= 0 && j <= 30) {
            dpProches.push({ dossierLabel: label, mexNom: mex.nom, days: j });
          }
        }
      }
      for (const r of getDMLsEnRetard(d)) {
        dmlsRetard.push({ dossierLabel: label, mexNom: r.mex.nom, joursRetard: r.joursRetard });
      }
      for (const debat of d.debatsJLD) {
        const dt = new Date(debat.date);
        const dayMs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
        const days = Math.ceil((dayMs - todayMs) / 86400000);
        if (days >= 0 && days <= 14) debatsProches.push({ dossierLabel: label, type: debat.type, days });
      }
    }
    return { dpProches, dmlsRetard, debatsProches };
  }, [instructionDossiers, today]);

  const hasInstructionItems = !!instructionSummary && (
    instructionSummary.dpProches.length > 0
    || instructionSummary.dmlsRetard.length > 0
    || instructionSummary.debatsProches.length > 0
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Récapitulatif — {today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </DialogTitle>
        </DialogHeader>

        {!hasSubscriptions ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            Aucun contentieux coché dans les paramètres du récapitulatif.
          </p>
        ) : (totalItems === 0 && !hasInstructionItems) ? (
          <p className="text-sm text-gray-500 py-4 text-center">Aucun élément à signaler cette semaine.</p>
        ) : (
          <div className="space-y-5 py-2">

            {/* ── INSTRUCTIONS (encart dédié) ── */}
            {hasInstructionItems && instructionSummary && (
              <div className="border border-purple-300 bg-purple-50 rounded-lg p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-1 mb-2">
                  <Gavel className="h-3.5 w-3.5" />
                  Module instruction (
                  {instructionSummary.dpProches.length
                    + instructionSummary.dmlsRetard.length
                    + instructionSummary.debatsProches.length}
                  )
                </h4>
                {instructionSummary.dmlsRetard.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[11px] font-semibold text-red-700 mb-1">DML en retard</div>
                    <ul className="space-y-1">
                      {instructionSummary.dmlsRetard.map((d, i) => (
                        <li key={`dmlr-${i}`} className="rounded bg-white border border-red-200 px-2 py-1 text-xs flex items-center justify-between gap-2">
                          <span><strong>{d.dossierLabel}</strong> — {d.mexNom}</span>
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                            {d.joursRetard}j de retard
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {instructionSummary.dpProches.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[11px] font-semibold text-red-700 mb-1">Fins de DP imminentes (≤30j)</div>
                    <ul className="space-y-1">
                      {instructionSummary.dpProches
                        .sort((a, b) => a.days - b.days)
                        .map((d, i) => (
                          <li key={`dp-${i}`} className="rounded bg-white border border-purple-200 px-2 py-1 text-xs flex items-center justify-between gap-2">
                            <span><strong>{d.dossierLabel}</strong> — {d.mexNom}</span>
                            <Badge variant="outline" className={d.days <= 7 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'}>
                              J+{d.days}
                            </Badge>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {instructionSummary.debatsProches.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-700 mb-1">Débats JLD à venir (≤14j)</div>
                    <ul className="space-y-1">
                      {instructionSummary.debatsProches
                        .sort((a, b) => a.days - b.days)
                        .map((d, i) => (
                          <li key={`dbt-${i}`} className="rounded bg-white border border-indigo-200 px-2 py-1 text-xs flex items-center justify-between gap-2">
                            <span><strong>{d.dossierLabel}</strong> — {d.type.replace('_', ' ')}</span>
                            <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-300">
                              J+{d.days}
                            </Badge>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── URGENCES ROUGES (tous contentieux confondus) ── */}
            {hasUrgent && (
              <div className="border border-red-300 bg-red-50 rounded-lg p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-red-700 flex items-center gap-1 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Urgences ({urgentActes.length + urgentRelances.length})
                </h4>

                {urgentActes.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {urgentActes.map(a => (
                      <li key={`u-${a.key}`} className="rounded-md px-3 py-2 text-sm bg-white border border-red-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium break-words">{a.enqueteNumero}</span>
                            <span className="text-gray-600 ml-1">{a.category} — à prolonger</span>
                            <span className="block text-[11px] text-gray-500 mt-0.5">{a.contentieuxLabel}</span>
                          </div>
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 shrink-0">
                            {a.daysLeft === 0 ? "Expire aujourd'hui" : `${a.daysLeft}j`}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {urgentRelances.length > 0 && (
                  <ul className="space-y-1.5">
                    {urgentRelances.map(({ enquete: e, contentieuxLabel, days }) => (
                      <li key={`ur-${e.id}`} className="rounded-md px-3 py-2 text-sm bg-white border border-red-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium break-words block">{e.numero}</span>
                            {e.directeurEnquete && (
                              <span className="text-gray-500 text-xs">({e.directeurEnquete})</span>
                            )}
                            <span className="block text-[11px] text-gray-500 mt-0.5">{contentieuxLabel}</span>
                          </div>
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 shrink-0">
                            {days}j sans CR
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ── 1 SECTION PAR CONTENTIEUX ABONNÉ ── */}
            {perContentieux.map(({ bucket, actes, relances }) => {
              if (actes.length === 0 && relances.length === 0) return null;
              return (
                <div key={bucket.contentieuxId} className="border-t pt-4 first:border-t-0 first:pt-0">
                  <h3
                    className="text-sm font-semibold flex items-center gap-2 mb-3"
                    style={bucket.contentieuxColor ? { color: bucket.contentieuxColor } : undefined}
                  >
                    {bucket.contentieuxColor && (
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: bucket.contentieuxColor }}
                      />
                    )}
                    {bucket.contentieuxLabel}
                  </h3>

                  {actes.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-red-600 flex items-center gap-1 mb-2">
                        <Calendar className="h-3.5 w-3.5" />
                        Échéances d'actes à venir ({actes.length})
                      </h4>
                      <ul className="space-y-1.5">
                        {actes.map(a => (
                          <li key={a.key} className={`rounded-lg px-3 py-2 text-sm ${a.daysLeft <= 2 ? 'bg-red-50' : 'bg-yellow-50'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="font-medium break-words">{a.enqueteNumero}</span>
                                <span className="text-gray-600 ml-1">{a.category} — à prolonger</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={`shrink-0 ${a.daysLeft <= 2
                                  ? 'bg-red-100 text-red-700 border-red-300'
                                  : 'bg-yellow-100 text-yellow-700 border-yellow-300'}`}
                              >
                                {a.daysLeft === 0 ? "Expire aujourd'hui" : `${a.daysLeft}j`}
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {relances.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-orange-600 flex items-center gap-1 mb-1">
                        <FileText className="h-3.5 w-3.5" />
                        Enquêtes à relancer ({relances.length})
                      </h4>
                      <p className="text-xs text-gray-500 mb-2">
                        Envoyer un mail d'actualisation aux directeurs d'enquêtes des enquêtes suivantes :
                      </p>
                      <ul className="space-y-1.5">
                        {relances.map(({ enquete: e, days }) => (
                          <li key={e.id} className="rounded-lg px-3 py-2 text-sm bg-orange-50">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium break-words block">{e.numero}</span>
                                {e.directeurEnquete && (
                                  <span className="text-gray-500 text-xs">({e.directeurEnquete})</span>
                                )}
                                <span className="text-xs text-gray-500 block break-words">
                                  {e.misEnCause.map(m => m.nom).join(', ')}
                                </span>
                              </div>
                              <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300 shrink-0">
                                {days}j sans CR
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
