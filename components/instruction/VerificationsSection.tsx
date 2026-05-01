'use client';

import React, { useMemo, useState } from 'react';
import { Plus, X, ClipboardCheck, AlertTriangle, Calendar as CalendarIcon, User as UserIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { useUser } from '@/contexts/UserContext';
import type { VerificationPeriodique } from '@/types/instructionTypes';

interface Props {
  verifications: VerificationPeriodique[];
  onChange: (next: VerificationPeriodique[]) => void;
  /** Intervalle au-delà duquel une nouvelle vérif est conseillée (jours, défaut 30) */
  intervalleAlerteJours?: number;
  readOnly?: boolean;
}

const CHECKLIST_ITEMS: { key: keyof NonNullable<VerificationPeriodique['checklist']>; label: string }[] = [
  { key: 'actesEnCours',       label: 'Actes en cours examinés' },
  { key: 'expertisesEnCours',  label: 'Expertises en cours suivies' },
  { key: 'mexQuiDorment',      label: 'MEX qui « dorment » repérés' },
  { key: 'delaiDP',            label: 'Délais DP vérifiés' },
  { key: 'relanceJI',          label: 'Relance JI faite si dossier traîne' },
];

export const VerificationsSection = ({ verifications, onChange, intervalleAlerteJours = 30, readOnly }: Props) => {
  const { user } = useUser();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<{
    contenu: string;
    checklist: NonNullable<VerificationPeriodique['checklist']>;
  }>({
    contenu: '',
    checklist: {},
  });

  const sorted = useMemo(
    () => [...verifications].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [verifications],
  );

  // Calcul de la dernière vérif & jours depuis
  const derniereVerif = sorted[0];
  const joursDepuis = useMemo(() => {
    if (!derniereVerif) return null;
    const d = new Date(derniereVerif.date);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - d.getTime()) / 86400000);
  }, [derniereVerif]);

  const enRetard = joursDepuis !== null && joursDepuis >= intervalleAlerteJours;
  const proche = joursDepuis !== null && joursDepuis >= intervalleAlerteJours - 7 && joursDepuis < intervalleAlerteJours;

  const handleAdd = () => {
    onChange([
      ...verifications,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: new Date().toISOString(),
        contenu: draft.contenu.trim() || undefined,
        checklist: Object.values(draft.checklist).some(v => v) ? draft.checklist : undefined,
        auteur: user?.windowsUsername,
      },
    ]);
    setDraft({ contenu: '', checklist: {} });
    setShowForm(false);
  };

  const handleRemove = (id: number) => {
    if (confirm('Supprimer cette vérification ?')) onChange(verifications.filter(v => v.id !== id));
  };

  return (
    <div className="space-y-3">
      {/* Bandeau état */}
      <div
        className={`rounded p-3 border ${
          !derniereVerif
            ? 'bg-gray-50 border-gray-200'
            : enRetard
            ? 'bg-red-50 border-red-200'
            : proche
            ? 'bg-amber-50 border-amber-200'
            : 'bg-emerald-50 border-emerald-200'
        }`}
      >
        <div className="flex items-center gap-2 text-sm">
          <ClipboardCheck className={`h-4 w-4 ${
            !derniereVerif
              ? 'text-gray-400'
              : enRetard
              ? 'text-red-600'
              : proche
              ? 'text-amber-600'
              : 'text-emerald-600'
          }`} />
          {!derniereVerif ? (
            <span className="text-gray-600">Aucune vérification périodique enregistrée pour ce dossier.</span>
          ) : enRetard ? (
            <span className="text-red-700 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Vérification due (dernière il y a {joursDepuis} j, seuil {intervalleAlerteJours} j)
            </span>
          ) : proche ? (
            <span className="text-amber-700">
              Prochaine vérification recommandée bientôt (dernière il y a {joursDepuis} j)
            </span>
          ) : (
            <span className="text-emerald-700">
              Dossier vérifié il y a {joursDepuis} j (intervalle conseillé : {intervalleAlerteJours} j)
            </span>
          )}
        </div>
      </div>

      {/* Liste */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map(v => {
            const validatedItems = v.checklist
              ? Object.entries(v.checklist).filter(([, val]) => val).map(([k]) => k)
              : [];
            return (
              <div key={v.id} className="border border-gray-200 rounded p-2 bg-white text-sm">
                <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                  <CalendarIcon className="h-3 w-3" />
                  {new Date(v.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  {v.auteur && (
                    <>
                      <span>·</span>
                      <UserIcon className="h-3 w-3" />
                      {v.auteur}
                    </>
                  )}
                  {!readOnly && (
                    <button
                      onClick={() => handleRemove(v.id)}
                      className="ml-auto text-gray-400 hover:text-red-600"
                      title="Supprimer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {v.contenu && (
                  <div className="text-gray-700 whitespace-pre-wrap">{v.contenu}</div>
                )}
                {validatedItems.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {validatedItems.map(k => {
                      const item = CHECKLIST_ITEMS.find(i => i.key === k);
                      if (!item) return null;
                      return (
                        <span
                          key={k}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                        >
                          ✓ {item.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-emerald-300 rounded p-3 bg-emerald-50/30 space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Point dossier</h4>
            <textarea
              value={draft.contenu}
              onChange={(e) => setDraft(d => ({ ...d, contenu: e.target.value }))}
              rows={3}
              placeholder="Notes du point dossier (état, prochaines étapes, points d'attention…)"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y"
            />
            <div>
              <Label className="text-xs">Checklist</Label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {CHECKLIST_ITEMS.map(item => (
                  <label key={item.key} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!draft.checklist[item.key]}
                      onChange={(e) =>
                        setDraft(d => ({
                          ...d,
                          checklist: { ...d.checklist, [item.key]: e.target.checked },
                        }))
                      }
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="h-7 text-xs">
                <X className="h-3 w-3 mr-1" />
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-3 w-3 mr-1" />
                Enregistrer la vérification
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-sm text-emerald-700 hover:bg-emerald-50 py-2 rounded border-2 border-dashed border-emerald-300 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Faire un point dossier
          </button>
        )
      )}
    </div>
  );
};
