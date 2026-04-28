import React, { useEffect, useState } from 'react';
import { Briefcase, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { useAudience } from '@/hooks/useAudience';
import { useToast } from '@/contexts/ToastContext';
import {
  Confiscations,
  emptyConfiscations,
  hasAnySaisies,
  ResultatAudience,
} from '@/types/audienceTypes';
import { SaisiesForm } from './SaisiesForm';

interface SaisiesSectionProps {
  enqueteId: number;
  /** Mode lecture seule (enquête partagée d'un autre contentieux) */
  readOnly?: boolean;
}

/**
 * Section "Saisies effectuées par les services d'enquête" affichée dans le détail
 * d'une enquête. Permet de saisir/modifier les saisies au fil de l'enquête, sans
 * attendre l'archivage.
 *
 * Cohérence des données : la même donnée (`ResultatAudience.saisies`) est partagée
 * avec le modal d'archivage. Pas de duplication. Au moment de l'archivage,
 * l'utilisateur retrouve ce qu'il a déjà saisi ici (et peut continuer à l'enrichir).
 */
export const SaisiesSection = React.memo(
  ({ enqueteId, readOnly = false }: SaisiesSectionProps) => {
    const { getResultat, saveResultat, deleteResultat } = useAudience();
    const { showToast } = useToast();

    const [expanded, setExpanded] = useState(false);
    const [saisies, setSaisies] = useState<Confiscations>(emptyConfiscations());
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);

    // (Re)charge depuis le store à l'ouverture de la section ou au changement d'enquête.
    // On évite d'écraser les modifs locales en cours en ne re-syncant que sur ces deux
    // déclencheurs (pas à chaque rendu / changement du store).
    useEffect(() => {
      if (!expanded) return;
      const resultat = getResultat(enqueteId);
      setSaisies(resultat?.saisies || emptyConfiscations());
      setDirty(false);
    }, [expanded, enqueteId, getResultat]);

    const handleChange = (updater: (prev: Confiscations) => Confiscations) => {
      setSaisies(updater);
      setDirty(true);
    };

    const handleSave = async () => {
      if (saving) return;
      setSaving(true);
      try {
        const existing = getResultat(enqueteId);
        const hasSaisies = hasAnySaisies(saisies);

        // Cas 1 : aucun résultat existant
        if (!existing) {
          if (!hasSaisies) {
            // Rien à sauvegarder, rien à supprimer
            setDirty(false);
            return;
          }
          const draft: ResultatAudience = {
            enqueteId,
            dateAudience: '',
            condamnations: [],
            confiscations: emptyConfiscations(),
            saisies,
            isPreArchiveSaisies: true,
          };
          await saveResultat(draft);
          setDirty(false);
          showToast('Saisies enregistrées', 'success');
          return;
        }

        // Cas 2 : un résultat existe déjà (draft pré-archivage OU audience archivée).
        // On met à jour `saisies` en place — pas de duplication, pas de perte des
        // autres champs (dateAudience, condamnations, confiscations, etc.).
        if (existing.isPreArchiveSaisies && !hasSaisies) {
          // Brouillon vidé de toutes ses saisies : supprimer le draft pour ne pas
          // laisser de record fantôme sans aucune donnée utile.
          await deleteResultat(enqueteId);
          setDirty(false);
          showToast('Saisies effacées', 'success');
          return;
        }

        const updated: ResultatAudience = {
          ...existing,
          saisies: hasSaisies ? saisies : undefined,
        };
        await saveResultat(updated);
        setDirty(false);
        showToast('Saisies enregistrées', 'success');
      } catch (err) {
        console.error('Erreur sauvegarde saisies:', err);
        showToast('Erreur lors de l\'enregistrement des saisies', 'error');
      } finally {
        setSaving(false);
      }
    };

    // Compteur affiché dans l'entête (depuis le store, pas l'état local non sauvegardé)
    const stored = getResultat(enqueteId);
    const storedSaisies = stored?.saisies;
    const counts = {
      vehicules: storedSaisies?.vehicules?.length || 0,
      immeubles: storedSaisies?.immeubles?.length || 0,
      bancaires: storedSaisies?.saisiesBancaires?.length || 0,
      crypto: storedSaisies?.cryptomonnaies?.length || 0,
      objets: storedSaisies?.objetsMobiliers?.length || 0,
      numeraire: storedSaisies?.numeraire || 0,
      stups: storedSaisies?.stupefiants?.types?.length || 0,
    };
    const totalCount =
      counts.vehicules +
      counts.immeubles +
      counts.bancaires +
      counts.crypto +
      counts.objets +
      counts.stups +
      (counts.numeraire > 0 ? 1 : 0);

    const canEdit = !readOnly;

    return (
      <div className="bg-gray-50 p-3 rounded-lg">
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-500" />
            )}
            <Briefcase className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold">
              Saisies{' '}
              {totalCount > 0 ? (
                <span className="text-emerald-700 font-medium">({totalCount})</span>
              ) : (
                <span className="text-xs text-gray-400 italic ml-1 font-normal">— Aucune</span>
              )}
            </h3>
          </div>
        </button>

        {expanded && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-500">
              Saisies effectuées par les services d'enquête. Ces données seront automatiquement
              reprises au moment de l'archivage et pourront pré-remplir les confiscations à l'audience.
            </p>

            {canEdit ? (
              <>
                <SaisiesForm saisies={saisies} onChange={handleChange} />
                <div className="flex justify-end items-center gap-2 pt-2">
                  {dirty && (
                    <span className="text-xs text-amber-600 italic">
                      Modifications non enregistrées
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    className="gap-1"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Enregistrement…' : 'Enregistrer les saisies'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500 italic">Lecture seule.</p>
            )}
          </div>
        )}
      </div>
    );
  }
);

SaisiesSection.displayName = 'SaisiesSection';
