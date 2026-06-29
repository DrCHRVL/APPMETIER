'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2, Wand2, Link2, Check } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useNatinf } from '@/hooks/useNatinf';
import { useToast } from '@/contexts/ToastContext';
import { NatinfPicker } from './NatinfPicker';
import { NatinfBadge } from './NatinfBadge';
import type { NatinfEntry } from '@/types/natinf';

interface Row {
  tagId: string;
  value: string;
  currentCode?: string;   // NATINF déjà rattaché
  chosen?: NatinfEntry;   // suggestion / choix courant
  accepted: boolean;      // sera enregistré
}

/**
 * Assistant de rattachement en masse des tags « infractions » au référentiel
 * NATINF : pour chaque tag, propose le NATINF correspondant (rapprochement
 * automatique de libellé), modifiable, validable en lot. Une fois rattaché, le
 * NATINF se répercute partout (affichage, stats) via TagDefinition.natinfCodes.
 */
export function NatinfReconcileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tags, updateTag } = useTags();
  const { search, getByCode, isLoading } = useNatinf();
  const { showToast } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);

  useEffect(() => {
    if (!open || isLoading) return;
    const infra = tags.filter((t) => t.category === 'infractions');
    setRows(
      infra
        .sort((a, b) => a.value.localeCompare(b.value, 'fr'))
        .map((t) => {
          const currentCode = t.natinfCodes?.[0];
          const current = currentCode ? getByCode(currentCode) : undefined;
          const suggestion = current || search(t.value, { limit: 1 })[0];
          return { tagId: t.id, value: t.value, currentCode, chosen: suggestion, accepted: false };
        }),
    );
    // on ne dépend volontairement que de open/isLoading pour figer l'état à l'ouverture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading]);

  const visible = useMemo(
    () => (onlyUnlinked ? rows.filter((r) => !r.currentCode) : rows),
    [rows, onlyUnlinked],
  );
  const acceptedCount = rows.filter((r) => r.accepted && r.chosen).length;
  const unlinkedCount = rows.filter((r) => !r.currentCode).length;

  const setChosen = (tagId: string, entry: NatinfEntry) =>
    setRows((rs) => rs.map((r) => (r.tagId === tagId ? { ...r, chosen: entry, accepted: true } : r)));

  const toggleAccept = (tagId: string) =>
    setRows((rs) => rs.map((r) => (r.tagId === tagId ? { ...r, accepted: !r.accepted } : r)));

  const acceptAllSuggestions = () =>
    setRows((rs) => rs.map((r) => (r.chosen && !r.currentCode ? { ...r, accepted: true } : r)));

  const save = async () => {
    setSaving(true);
    let n = 0;
    for (const r of rows) {
      if (r.accepted && r.chosen && r.chosen.code !== r.currentCode) {
        const ok = await updateTag(r.tagId, { natinfCodes: [r.chosen.code] });
        if (ok) n++;
      }
    }
    setSaving(false);
    showToast(n > 0 ? `${n} tag(s) rattaché(s) au NATINF.` : 'Aucun changement.', n > 0 ? 'success' : 'info');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => !saving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-emerald-600" />
            Rattacher les tags d'infraction au NATINF
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-gray-600">
            <input
              type="checkbox"
              checked={onlyUnlinked}
              onChange={(e) => setOnlyUnlinked(e.target.checked)}
            />
            Afficher seulement les non rattachés ({unlinkedCount})
          </label>
          <Button variant="outline" size="sm" onClick={acceptAllSuggestions} className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Accepter toutes les suggestions
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin inline" /> Chargement du référentiel…
            </div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-center text-gray-400 italic">
              {onlyUnlinked ? 'Tous les tags sont déjà rattachés.' : 'Aucun tag d’infraction.'}
            </div>
          ) : (
            visible.map((r) => (
              <div key={r.tagId} className="flex items-center gap-3 p-2">
                <input
                  type="checkbox"
                  checked={r.accepted}
                  onChange={() => toggleAccept(r.tagId)}
                  disabled={!r.chosen}
                  title="À enregistrer"
                />
                <span className="w-40 shrink-0 truncate text-sm font-medium text-gray-800" title={r.value}>
                  {r.value}
                </span>
                <span className="text-gray-300">→</span>
                <div className="flex-1 min-w-0">
                  {r.chosen ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">{r.chosen.code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={r.chosen.libelle}>
                        {r.chosen.libelle}
                      </span>
                      <NatinfBadge nature={r.chosen.nature} quantumLabel={r.chosen.quantumLabel} className="shrink-0" />
                    </div>
                  ) : (
                    <span className="text-xs text-amber-600">Aucune suggestion — choisir manuellement</span>
                  )}
                  <div className="mt-1">
                    <NatinfPicker
                      onSelect={(e) => setChosen(r.tagId, e)}
                      placeholder={r.chosen ? 'Changer le NATINF…' : 'Rechercher un NATINF…'}
                    />
                  </div>
                </div>
                {r.currentCode && (
                  <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-emerald-700" title="Déjà rattaché">
                    <Link2 className="h-3 w-3" /> lié
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={save} disabled={saving || acceptedCount === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Enregistrer {acceptedCount > 0 ? `(${acceptedCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
