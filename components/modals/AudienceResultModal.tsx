import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { MecAutocompleteInput } from '../ui/MecAutocompleteInput';
import { CondamnationData, Confiscations, ResultatAudience, VehiculeSaisi, ImmeubleSaisi, SaisieBancaire, CryptoSaisie, ObjetMobilier, TypeVehicule, TypeImmeuble, CategorieObjet, emptyConfiscations, migrateConfiscations, mergeConfiscations, countConfiscations, hasAnySaisies } from '@/types/audienceTypes';
import { StupefiantsEditor } from '../sections/StupefiantsEditor';
import { useToast } from '@/contexts/ToastContext';
import { useAudience } from '@/hooks/useAudience';
import { useTags } from '@/hooks/useTags';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { useNatinf } from '@/hooks/useNatinf';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { NatinfPicker } from '../natinf/NatinfPicker';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '../ui/badge';
import { Clock } from 'lucide-react';
import { SuiviAlertModal } from './SuiviAlertModal';
import { OverboardPinnedAlertModal } from './OverboardPinnedAlertModal';
import { Tag, ToDoItem } from '@/types/interfaces';

// Extension de CondamnationData pour inclure le statut pending
interface ExtendedCondamnationData extends CondamnationData {
  isPending?: boolean;
  dateAudiencePending?: string;
  dateDefere?: string;
  isRelaxe?: boolean;
}

// Types
interface AudienceResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (resultat: ResultatAudience) => void | Promise<void>;
  enqueteId: number;
  /** Contentieux propriétaire — propagé sur tout résultat sauvegardé. */
  contentieuxId: string;
  defaultDate?: string;
  initialData?: ResultatAudience;
  isDirectResult?: boolean;
  misEnCause?: { id: number; nom: string }[];
  enqueteNumero?: string;
  enqueteTags?: Tag[];
  /** Codes NATINF du dossier (pour pré-remplir un dossier 100% NATINF sans tags). */
  enqueteInfractionCodes?: string[];
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
  isOverboardPinned?: boolean;
}

export const AudienceResultModal = ({
  isOpen,
  onClose,
  onSave,
  enqueteId,
  contentieuxId,
  defaultDate,
  initialData,
  isDirectResult,
  misEnCause = [],
  enqueteNumero = '',
  enqueteTags = [],
  enqueteInfractionCodes,
  onCreateGlobalTodo,
  isOverboardPinned = false,
}: AudienceResultModalProps) => {
  // States
  const { getTagsByCategory } = useTags();
  const { natinfForTag } = useInfractionNatinf();
  const { getByCode } = useNatinf();
  const [dateAudience, setDateAudience] = useState(initialData?.dateAudience || defaultDate || '');

  // Multi-sélection des types d'infraction, en codes NATINF natifs. Pré-remplissage
  // par ordre de priorité : codes déjà saisis dans le résultat ; sinon résolution
  // des libellés saisis via leur tag ; sinon codes du dossier ; sinon tags
  // d'infraction du dossier résolus. L'utilisateur peut ajouter/retirer.
  const initialSelectedCodes = (() => {
    let codes: string[];
    if (initialData?.infractionNatinfCodes?.length) {
      codes = initialData.infractionNatinfCodes;
    } else if (initialData?.typesInfraction?.length) {
      codes = initialData.typesInfraction
        .map(v => natinfForTag(v)?.code)
        .filter((c): c is string => Boolean(c));
    } else if (enqueteInfractionCodes?.length) {
      codes = enqueteInfractionCodes;
    } else {
      codes = enqueteTags
        .filter(t => t.category === 'infractions')
        .map(t => natinfForTag(t.value)?.code)
        .filter((c): c is string => Boolean(c));
    }
    return Array.from(new Set(codes));
  })();
  const [selectedCodes, setSelectedCodes] = useState<string[]>(initialSelectedCodes);

  // Date de défèrement issue de l'audience en attente (commune, à pré-remplir sur chaque condamné déféré)
  const pendingDateDefere = initialData?.dateDefere || '';

  // Re-hydrater les pendingCondamnations depuis initialData (résultats partiels)
  const buildInitialCondamnations = (): ExtendedCondamnationData[] => {
    const finalized = (initialData?.condamnations || []).map(c => ({
      ...c,
      isPending: false,
      dateAudiencePending: c.dateAudiencePending || '',
      dateDefere: c.dateDefere || (c.defere ? pendingDateDefere : '')
    }));
    const pending = (initialData?.pendingCondamnations || []).map(p => ({
      nom: p.nom,
      peinePrison: 0,
      sursisProbatoire: 0,
      sursisSimple: 0,
      peineAmende: 0,
      interdictionParaitre: false,
      interdictionGerer: false,
      typeAudience: 'CI' as const,
      defere: true,
      dateDefere: pendingDateDefere,
      isPending: true,
      dateAudiencePending: p.dateAudiencePending || ''
    }));
    return [...finalized, ...pending];
  };

  const initialCondamnations = buildInitialCondamnations();
  const [nbCondamnes, setNbCondamnes] = useState(initialCondamnations.length || 0);
  const [condamnations, setCondamnations] = useState<ExtendedCondamnationData[]>(initialCondamnations);
  // Si des saisies existent et que les confiscations sont vides, pré-remplir les confiscations depuis les saisies
  const getInitialConfiscations = (): Confiscations => {
    if (initialData?.confiscations) {
      const migrated = migrateConfiscations(initialData.confiscations);
      const isEmpty = migrated.vehicules.length === 0 && migrated.immeubles.length === 0 &&
        migrated.numeraire === 0 && migrated.saisiesBancaires.length === 0 &&
        migrated.cryptomonnaies.length === 0 && migrated.objetsMobiliers.length === 0 &&
        !migrated.stupefiants?.types?.length && !migrated.stupefiants?.produits?.length;
      // Si confiscations déjà renseignées, les utiliser (copie : l'état local
      // ne doit jamais partager ses tableaux avec l'enregistrement du store)
      if (!isEmpty) return JSON.parse(JSON.stringify(migrated));
    }
    // Sinon, pré-remplir depuis les saisies si disponibles
    if (initialData?.saisies) {
      return migrateConfiscations(JSON.parse(JSON.stringify(initialData.saisies)));
    }
    return emptyConfiscations();
  };
  const [confiscations, setConfiscations] = useState<Confiscations>(getInitialConfiscations());
  const [prefilledFromSaisies] = useState<boolean>(() => {
    if (!initialData?.saisies) return false;
    if (initialData?.confiscations) {
      const migrated = migrateConfiscations(initialData.confiscations);
      const isEmpty = migrated.vehicules.length === 0 && migrated.immeubles.length === 0 &&
        migrated.numeraire === 0 && migrated.saisiesBancaires.length === 0 &&
        migrated.cryptomonnaies.length === 0 && migrated.objetsMobiliers.length === 0 &&
        !migrated.stupefiants?.types?.length && !migrated.stupefiants?.produits?.length;
      return isEmpty;
    }
    return true;
  });

  const { showToast } = useToast();

  // Saisies d'enquête disponibles pour un report manuel dans les confiscations.
  // Cas typique : reprise d'un dossier archivé dont les confiscations avaient
  // été renseignées avant que les saisies ne soient documentées — le
  // pré-remplissage automatique ne joue pas (confiscations non vides), il faut
  // pouvoir reporter à la demande plutôt que tout retaper.
  const saisiesEnquete = initialData?.saisies;
  const nbSaisiesEnquete = hasAnySaisies(saisiesEnquete) ? countConfiscations(saisiesEnquete) : 0;

  const handleReporterSaisies = () => {
    if (!saisiesEnquete) return;
    const { merged, totalAdded } = mergeConfiscations(confiscations, saisiesEnquete);
    if (totalAdded === 0) {
      showToast('Les saisies sont déjà toutes reportées dans les confiscations', 'info');
      return;
    }
    setConfiscations(merged);
    showToast(
      `${totalAdded} élément(s) repris depuis les saisies — vérifiez avant d'enregistrer`,
      'success'
    );
  };

  const handleRemplacerParSaisies = () => {
    if (!saisiesEnquete) return;
    if (!confirm('Remplacer toutes les confiscations par les saisies d\'enquête ? Les lignes actuelles seront perdues.')) return;
    setConfiscations(migrateConfiscations(JSON.parse(JSON.stringify(saisiesEnquete))));
    showToast('Confiscations remplacées par les saisies d\'enquête', 'success');
  };

  const { audienceState } = useAudience();
  const [service, setService] = useState(initialData?.service || '');
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [showOverboardAlert, setShowOverboardAlert] = useState(false);
  const hasSuivi = enqueteTags.some(t => t.category === 'suivi');

  // Lieux d'interdiction de paraître déjà enregistrés (pour suggestions)
  const lieuxInterdictionExistants = React.useMemo(() => {
    const defaultLieux = ['Somme', 'Amiens', 'Abbeville', 'Péronne', 'Montdidier'];
    const allResultats = audienceState?.resultats ? Object.values(audienceState.resultats) : [];
    const lieuxFromData = allResultats
      .flatMap(r => r.condamnations || [])
      .map(c => c.lieuInterdictionParaitre)
      .filter((l): l is string => !!l && l.trim() !== '');
    return [...new Set([...defaultLieux, ...lieuxFromData])].sort();
  }, [audienceState?.resultats]);

  // Récupération des tags via le hook
  const services = getTagsByCategory('services');

  // Handlers
  const handleNbCondamnesChange = (nb: number) => {
    setNbCondamnes(nb);
    const newCondamnations = Array(nb).fill(null).map((_, index) => {
      // Conserver les données existantes si elles existent
      if (condamnations[index]) {
        return condamnations[index];
      }
      return {
        nom: '',
        peinePrison: 0,
        sursisProbatoire: 0,
        sursisSimple: 0,
        peineAmende: 0,
        interdictionParaitre: false,
        interdictionGerer: false,
        typeAudience: 'CI' as const,
        defere: true,
        dateDefere: pendingDateDefere,
        isPending: false,
        isRelaxe: false,
        dateAudiencePending: ''
      };
    });
    setCondamnations(newCondamnations);
  };

  const updateCondamnation = (index: number, field: keyof ExtendedCondamnationData, value: string | number | boolean) => {
    const newCondamnations = [...condamnations];
    newCondamnations[index] = {
      ...newCondamnations[index],
      [field]: field === 'nom' || field === 'dateDefere' || field === 'lieuInterdictionParaitre' ? value :
               field === 'interdictionParaitre' || field === 'interdictionGerer' || field === 'defere' || field === 'isPending' || field === 'isRelaxe' ? Boolean(value) :
               field === 'typeAudience' || field === 'dateAudiencePending' ? value :
               (parseInt(value as string) || 0)
    };
    setCondamnations(newCondamnations);
  };

  // Handler spécifique pour le nom : auto-remplit misEnCauseId si le nom correspond à un MEC connu
  const updateCondamnationNom = (index: number, nom: string) => {
    const matchedMec = misEnCause.find(m => m.nom.toLowerCase() === nom.toLowerCase());
    const newCondamnations = [...condamnations];
    newCondamnations[index] = {
      ...newCondamnations[index],
      nom,
      misEnCauseId: matchedMec ? matchedMec.id : undefined
    };
    setCondamnations(newCondamnations);
  };

  // Relaxe : la personne a comparu sans être condamnée. On remet toutes les
  // peines à zéro (elles ne doivent jamais être ré-agrégées) mais on garde le
  // nom, le type d'audience et le défèrement — la personne a bien été déférée
  // et jugée, seule la condamnation manque.
  const setRelaxe = (index: number, isRelaxe: boolean) => {
    const newCondamnations = [...condamnations];
    newCondamnations[index] = isRelaxe
      ? {
          ...newCondamnations[index],
          isRelaxe: true,
          isPending: false,
          peinePrison: 0,
          sursisProbatoire: 0,
          sursisSimple: 0,
          peineAmende: 0,
          interdictionParaitre: false,
          lieuInterdictionParaitre: undefined,
          dureeInterdictionParaitre: undefined,
          interdictionGerer: false,
          dureeInterdictionGerer: undefined,
        }
      : { ...newCondamnations[index], isRelaxe: false };
    setCondamnations(newCondamnations);
  };

  // Défèrement : cocher la case sans date perdrait le rattachement au bon mois
  // (les stats retomberaient sur la date d'audience, souvent très postérieure).
  // On pré-remplit donc avec la date saisie à l'archivage.
  const setDefere = (index: number, defere: boolean) => {
    const newCondamnations = [...condamnations];
    newCondamnations[index] = {
      ...newCondamnations[index],
      defere,
      dateDefere: defere
        ? (newCondamnations[index].dateDefere || pendingDateDefere)
        : newCondamnations[index].dateDefere,
    };
    setCondamnations(newCondamnations);
  };

  const handleSubmit = async () => {
    try {
      if (selectedCodes.length === 0) {
        showToast('Veuillez sélectionner au moins un type d\'infraction', 'error');
        return;
      }

      // Vérifier que les condamnés en attente ont une date d'audience
      const pendingWithoutDate = condamnations.some(c => c.isPending && !c.dateAudiencePending);
      if (pendingWithoutDate) {
        showToast('Veuillez renseigner la date d\'audience pour tous les condamnés en attente', 'error');
        return;
      }

      // Séparer les condamnations finalisées des pending
      const finalizedCondamnations = condamnations.filter(c => !c.isPending);
      const pendingCondamnations = condamnations.filter(c => c.isPending);

      // Déterminer si l'enquête a des résultats partiels
      const hasPartialResults = finalizedCondamnations.length > 0 && pendingCondamnations.length > 0;

      // Lignes effectivement enregistrées : une ligne n'est conservée que si
      // elle porte une décision — une peine, ou une relaxe explicite. Sans le
      // cas `isRelaxe`, un relaxé (toutes peines à 0) disparaîtrait à
      // l'enregistrement, avec son défèrement.
      const condamnationsAEnregistrer = finalizedCondamnations
        .filter(c =>
          c.isRelaxe ||
          c.peinePrison > 0 || c.sursisProbatoire > 0 ||
          c.sursisSimple > 0 || c.peineAmende > 0
        )
        .map(c => ({
          ...c,
          // Filet de sécurité pour les audiences à date lointaine : un déféré
          // sans date reprend celle saisie à l'archivage, sinon les stats le
          // rattacheraient au mois de l'audience et non à celui du défèrement.
          dateDefere: c.defere ? (c.dateDefere || pendingDateDefere || undefined) : c.dateDefere,
        }));

      // Vérifier si des défèrements étaient attendus (depuis audience en attente).
      // Une relaxe compte : la personne a bien été déférée, seule la
      // condamnation manque.
      const nbDeferesSaisis = condamnationsAEnregistrer.filter(c => c.defere).length;
      const nbDeferesAttendus = initialData?.nombreDeferes;

      if (nbDeferesAttendus && nbDeferesSaisis !== nbDeferesAttendus) {
        showToast(
          `Attention : ${nbDeferesAttendus} déférés attendus, ${nbDeferesSaisis} saisis`,
          'warning'
        );
      }

      const resultat: ResultatAudience = {
        enqueteId,
        contentieuxId,
        dateAudience,
        condamnations: condamnationsAEnregistrer,
        confiscations,
        // Source canonique : codes NATINF. Les libellés sont dérivés pour la
        // compat des filtres/interdictions (typeInfraction / typesInfraction).
        infractionNatinfCodes: selectedCodes,
        typesInfraction: selectedCodes.map(c => getByCode(c)?.libelle ?? `NATINF ${c}`),
        typeInfraction: selectedCodes[0]
          ? (getByCode(selectedCodes[0])?.libelle ?? `NATINF ${selectedCodes[0]}`)
          : undefined,
        isDirectResult,
        service: isDirectResult ? service : undefined,
        // Nouvelles propriétés pour gérer les résultats partiels
        hasPartialResults,
        pendingCondamnations: pendingCondamnations.map(c => ({
          nom: c.nom || '',
          dateAudiencePending: c.dateAudiencePending || ''
        })),
        isPartiallyPending: hasPartialResults,
        // Champs que ce modal n'édite pas : ils doivent survivre à une
        // ré-édition du résultat. Sans cette reprise explicite, enregistrer
        // les confiscations d'un dossier archivé effaçait les saisies
        // renseignées depuis le détail de l'enquête (et déclassait une OI en
        // audience ordinaire dans les statistiques).
        saisies: initialData?.saisies,
        numeroAudience: initialData?.numeroAudience,
        isOI: initialData?.isOI,
        // Défèrements : dès qu'une personne est marquée déférée, ce sont les
        // lignes individuelles qui font foi (chacune porte sa propre date) et
        // le couple de niveau résultat est effacé — le conserver ferait
        // compter deux fois les mêmes déférés dans les cartes qui lisent
        // `nombreDeferes` en priorité. S'il n'y en a aucune, en revanche, on
        // ne jette pas ce qui avait été saisi à l'archivage.
        dateDefere: nbDeferesSaisis > 0 ? undefined : initialData?.dateDefere,
        nombreDeferes: nbDeferesSaisis > 0 ? undefined : initialData?.nombreDeferes
      };
      
      await onSave(resultat);
      showToast('Résultats d\'audience enregistrés', 'success');
      if (isOverboardPinned) {
        setShowOverboardAlert(true);
      } else if (hasSuivi) {
        setShowSuiviAlert(true);
      } else {
        onClose();
      }
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      showToast('Erreur lors de l\'enregistrement des résultats', 'error');
    }
  };

  // Compter les condamnations finalisées, les relaxes et les personnes en attente
  const finalizedCount = condamnations.filter(c => !c.isPending && !c.isRelaxe).length;
  const pendingCount = condamnations.filter(c => c.isPending).length;
  const relaxeCount = condamnations.filter(c => !c.isPending && c.isRelaxe).length;

  // Render
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDirectResult ? 'Procédure de permanence' : 'Résultats d\'audience'}
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                <Clock className="h-3 w-3 mr-1" />
                {pendingCount} en attente
              </Badge>
            )}
            {relaxeCount > 0 && (
              <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                {relaxeCount} relaxe{relaxeCount > 1 ? 's' : ''}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date d'audience */}
          <div>
            <Label>Date d'audience principale</Label>
            <Input
              type="date"
              value={dateAudience}
              onChange={(e) => setDateAudience(e.target.value)}
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              Pour les condamnés finalisés. Les dates spécifiques sont renseignées individuellement.
            </p>
          </div>

          {/* Type d'infraction (multi-sélection NATINF native, pré-remplie depuis le dossier) */}
          <div>
            <Label>Types d'infraction</Label>
            <p className="text-xs text-gray-500 mb-2">
              Recherchez par n° NATINF ou libellé. Le premier sélectionné (★) est
              utilisé comme infraction principale pour les statistiques.
            </p>

            <div className="space-y-2">
              <NatinfPicker
                onSelect={(entry) =>
                  setSelectedCodes(prev => prev.includes(entry.code) ? prev : [...prev, entry.code])
                }
                placeholder="Ajouter une infraction (n° NATINF ou libellé)…"
              />

              {selectedCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedCodes.map((code, i) => {
                    const e = getByCode(code);
                    const principal = i === 0;
                    return (
                      <Badge key={code} variant="secondary" className="flex items-center gap-1">
                        {principal && <span title="Infraction principale">★</span>}
                        {e?.libelle ?? `NATINF ${code}`}
                        <NatinfBadge code={code} nature={e?.nature} quantumLabel={e?.quantumLabel} compact />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 ml-1"
                          aria-label={`Retirer ${e?.libelle ?? `NATINF ${code}`}`}
                          onClick={() => setSelectedCodes(prev => prev.filter(c => c !== code))}
                        >
                          ×
                        </Button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Ajout du champ service uniquement pour les procédures de permanence */}
          {isDirectResult && (
            <div>
              <Label>Service</Label>
              <select
                className="w-full p-2 border rounded"
                value={service}
                onChange={(e) => setService(e.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {services.map((service) => (
                  <option key={service.id} value={service.value}>
                    {service.value}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Nombre de condamnés */}
          <div>
            <Label>Nombre total de personnes concernées</Label>
            <Input
              type="number"
              min="0"
              value={nbCondamnes}
              onChange={(e) => handleNbCondamnesChange(parseInt(e.target.value) || 0)}
            />
            {(pendingCount > 0 || relaxeCount > 0) && (
              <p className="text-sm text-blue-600 mt-1">
                {finalizedCount} condamné(s)
                {relaxeCount > 0 && ` • ${relaxeCount} relaxe(s)`}
                {pendingCount > 0 && ` • ${pendingCount} en attente`}
              </p>
            )}
          </div>

          {/* Liste des condamnés */}
          {condamnations.map((condamnation, index) => (
            <div 
              key={index} 
              className={`space-y-4 border-t pt-4 ${
                condamnation.isPending ? 'bg-blue-50 p-4 rounded-lg border-blue-200' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {condamnation.isRelaxe ? `Relaxé ${index + 1}` : `Condamné ${index + 1}`}
                  {condamnation.isPending && (
                    <Badge variant="outline" className="ml-2 bg-blue-100 text-blue-800">
                      En attente
                    </Badge>
                  )}
                  {condamnation.isRelaxe && (
                    <Badge variant="outline" className="ml-2 bg-emerald-100 text-emerald-800 border-emerald-200">
                      Relaxe
                    </Badge>
                  )}
                </h3>

                <div className="flex items-center gap-4">
                  {/* Toggle relaxe (exclusif du statut « en attente ») */}
                  {!condamnation.isPending && (
                    <div className="flex items-center space-x-2">
                      <Label className="text-sm">Relaxe</Label>
                      <Switch
                        checked={condamnation.isRelaxe || false}
                        onCheckedChange={(checked) => setRelaxe(index, checked)}
                      />
                    </div>
                  )}

                  {/* Toggle statut pending */}
                  {!condamnation.isRelaxe && (
                    <div className="flex items-center space-x-2">
                      <Label className="text-sm">En attente d'audience</Label>
                      <Switch
                        checked={condamnation.isPending || false}
                        onCheckedChange={(checked) => updateCondamnation(index, 'isPending', checked)}
                      />
                    </div>
                  )}
                </div>
              </div>
              
              {/* Informations de base */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Nom du condamné
                    {condamnation.misEnCauseId && (
                      <span className="ml-2 text-xs text-green-600 font-normal">lié au dossier</span>
                    )}
                  </Label>
                  {misEnCause.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 mb-1">
                      {misEnCause.map((m) => {
                        const isSelected = condamnation.misEnCauseId === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => updateCondamnationNom(index, m.nom)}
                            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                              isSelected
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                            title="Cliquer pour utiliser ce mis en cause"
                          >
                            {m.nom}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <MecAutocompleteInput
                    value={condamnation.nom || ''}
                    onChange={(val) => updateCondamnationNom(index, val)}
                    suggestions={misEnCause.map(m => m.nom)}
                    minTriggerLength={2}
                    placeholder="Ou saisir un nom (texte libre)"
                  />
                </div>
                
                {condamnation.isPending && (
                  <div>
                    <Label>Date d'audience prévue</Label>
                    <Input
                      type="date"
                      value={condamnation.dateAudiencePending || ''}
                      onChange={(e) => updateCondamnation(index, 'dateAudiencePending', e.target.value)}
                      className="border-blue-300"
                    />
                  </div>
                )}
              </div>

              {/* Détails seulement si pas en attente */}
              {!condamnation.isPending && (
                <>
                  {/* Type d'audience et déférement */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <Label>Type d'audience</Label>
                      <select
                        className="w-full p-2 border rounded"
                        value={condamnation.typeAudience}
                        onChange={(e) => updateCondamnation(index, 'typeAudience', e.target.value)}
                      >
                        <option value="CRPC-Def">CRPC-Def</option>
                        <option value="CI">CI</option>
                        <option value="COPJ">COPJ</option>
                        <option value="OI">OI</option>
                        <option value="CDD">CDD</option>
                      </select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Label>Déférement</Label>
                      <Switch
                        checked={condamnation.defere}
                        onCheckedChange={(checked) => setDefere(index, checked)}
                      />
                    </div>
                  </div>

                  {/* Date de déférement si déféré */}
                  {condamnation.defere && (
                    <div className="mb-4">
                      <Label>Date du déférement</Label>
                      <Input
                        type="date"
                        value={condamnation.dateDefere || ''}
                        onChange={(e) => updateCondamnation(index, 'dateDefere', e.target.value)}
                        className="border-blue-300"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Pour les stats, cette date sera utilisée plutôt que la date d'audience
                      </p>
                    </div>
                  )}

                  {/* Peines — sans objet en cas de relaxe */}
                  {condamnation.isRelaxe ? (
                    <div className="bg-emerald-50 p-3 rounded border-l-4 border-emerald-400">
                      <p className="text-sm text-emerald-800">
                        Relaxe : aucune peine n'est prononcée. La personne reste comptée
                        parmi les personnes jugées et son défèrement est conservé, mais elle
                        sort des condamnations et des moyennes de peine.
                      </p>
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Peine de prison ferme (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.peinePrison}
                        onChange={(e) => updateCondamnation(index, 'peinePrison', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Sursis probatoire (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.sursisProbatoire}
                        onChange={(e) => updateCondamnation(index, 'sursisProbatoire', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Sursis simple (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.sursisSimple}
                        onChange={(e) => updateCondamnation(index, 'sursisSimple', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Amende (€)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.peineAmende}
                        onChange={(e) => updateCondamnation(index, 'peineAmende', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`interdiction-${index}`}
                        checked={!!condamnation.interdictionParaitre}
                        onChange={(e) => updateCondamnation(index, 'interdictionParaitre', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor={`interdiction-${index}`}>Interdiction de paraître</Label>
                    </div>
                    {condamnation.interdictionParaitre && (
                      <div className="col-span-2 grid grid-cols-2 gap-4 mt-1 pl-6 border-l-2 border-amber-300">
                        <div>
                          <Label>Lieu d'interdiction</Label>
                          <Input
                            list={`lieux-interdiction-${index}`}
                            placeholder="Ex: Amiens"
                            value={condamnation.lieuInterdictionParaitre || ''}
                            onChange={(e) => updateCondamnation(index, 'lieuInterdictionParaitre', e.target.value)}
                          />
                          <datalist id={`lieux-interdiction-${index}`}>
                            {lieuxInterdictionExistants.map(lieu => (
                              <option key={lieu} value={lieu} />
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <Label>Durée (mois)</Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Ex: 12"
                            value={condamnation.dureeInterdictionParaitre || ''}
                            onChange={(e) => updateCondamnation(index, 'dureeInterdictionParaitre', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`interdiction-gerer-${index}`}
                        checked={!!condamnation.interdictionGerer}
                        onChange={(e) => updateCondamnation(index, 'interdictionGerer', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor={`interdiction-gerer-${index}`}>Interdiction de gérer</Label>
                    </div>
                    {condamnation.interdictionGerer && (
                      <div className="col-span-2 pl-6 border-l-2 border-purple-300 mt-1">
                        <div>
                          <Label>Durée (mois)</Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Ex: 24"
                            value={condamnation.dureeInterdictionGerer || ''}
                            onChange={(e) => updateCondamnation(index, 'dureeInterdictionGerer', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                </>
              )}

              {condamnation.isPending && (
                <div className="bg-blue-100 p-3 rounded border-l-4 border-blue-400">
                  <p className="text-sm text-blue-800">
                    Cette personne sera jugée ultérieurement. L'enquête apparaîtra dans les "Audiences en attente" 
                    jusqu'à la finalisation de ce dossier.
                  </p>
                </div>
              )}
            </div>
          ))}

          {/* Confiscations */}
          <div className="border-t pt-4">
            <h3 className="font-medium mb-4">Confiscations et saisies</h3>
            {prefilledFromSaisies && (
              <div className="bg-green-50 border border-green-200 p-3 rounded-lg mb-4">
                <p className="text-sm text-green-800 font-medium">
                  Les confiscations ont été pré-remplies depuis les saisies effectuées en phase d'enquête.
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Vous pouvez valider tel quel ou modifier les valeurs si le juge a confisqué différemment.
                </p>
              </div>
            )}

            {!prefilledFromSaisies && nbSaisiesEnquete > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg mb-4 space-y-2">
                <p className="text-sm text-emerald-800 font-medium">
                  {nbSaisiesEnquete} élément(s) saisis en phase d'enquête sont enregistrés sur ce dossier.
                </p>
                <p className="text-xs text-emerald-700">
                  « Reporter » n'ajoute que ce qui manque ici : aucune ligne déjà présente n'est
                  modifiée ni dupliquée. « Remplacer » écrase les confiscations par les saisies.
                  Rien n'est enregistré tant que vous n'avez pas validé le formulaire.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={handleReporterSaisies}
                  >
                    Reporter les saisies
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                    onClick={handleRemplacerParSaisies}
                  >
                    Remplacer par les saisies
                  </Button>
                </div>
              </div>
            )}

            {/* --- Véhicules --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Véhicules ({confiscations.vehicules.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    vehicules: [...prev.vehicules, { type: 'voiture' as TypeVehicule }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.vehicules.map((v, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={v.type} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], type: e.target.value as TypeVehicule };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }}>
                        <option value="voiture">Voiture</option>
                        <option value="moto">Moto</option>
                        <option value="scooter">Scooter</option>
                        <option value="utilitaire">Utilitaire</option>
                        <option value="poids_lourd">Poids lourd</option>
                        <option value="bateau">Bateau</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Marque / Modèle</Label>
                      <Input className="text-sm" placeholder="Ex: BMW X3" value={v.marqueModele || ''} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], marqueModele: e.target.value };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }} />
                    </div>
                    <div>
                      <Label className="text-xs">Immatriculation</Label>
                      <Input className="text-sm" placeholder="AA-123-BB" value={v.immatriculation || ''} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], immatriculation: e.target.value };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={v.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.vehicules];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, vehicules: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, vehicules: prev.vehicules.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.vehicules.length === 0 && <p className="text-sm text-gray-400">Aucun véhicule saisi</p>}
              </div>
            </details>

            {/* --- Immeubles --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Immeubles ({confiscations.immeubles.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    immeubles: [...prev.immeubles, { type: 'appartement' as TypeImmeuble }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.immeubles.map((im, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={im.type} onChange={(e) => {
                        const arr = [...confiscations.immeubles];
                        arr[i] = { ...arr[i], type: e.target.value as TypeImmeuble };
                        setConfiscations(prev => ({ ...prev, immeubles: arr }));
                      }}>
                        <option value="appartement">Appartement</option>
                        <option value="maison">Maison</option>
                        <option value="terrain">Terrain</option>
                        <option value="local_commercial">Local commercial</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Adresse</Label>
                      <Input className="text-sm" value={im.adresse || ''} onChange={(e) => {
                        const arr = [...confiscations.immeubles];
                        arr[i] = { ...arr[i], adresse: e.target.value };
                        setConfiscations(prev => ({ ...prev, immeubles: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={im.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.immeubles];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, immeubles: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, immeubles: prev.immeubles.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.immeubles.length === 0 && <p className="text-sm text-gray-400">Aucun immeuble saisi</p>}
              </div>
            </details>

            {/* --- Avoirs financiers --- */}
            <details className="mb-4 border rounded-lg" open>
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg">Avoirs financiers</summary>
              <div className="p-3 space-y-4">
                {/* Numéraire */}
                <div>
                  <Label>Numéraire (espèces saisies) (€)</Label>
                  <Input type="number" min="0" value={confiscations.numeraire || ''} onChange={(e) =>
                    setConfiscations(prev => ({ ...prev, numeraire: parseInt(e.target.value) || 0 }))
                  } />
                </div>

                {/* Saisies bancaires */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Saisies bancaires</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() =>
                      setConfiscations(prev => ({ ...prev, saisiesBancaires: [...prev.saisiesBancaires, { montant: 0 }] }))
                    }>+ Ajouter</Button>
                  </div>
                  {confiscations.saisiesBancaires.map((sb, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-end mb-2 bg-gray-50 p-2 rounded">
                      <div>
                        <Label className="text-xs">Montant (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={sb.montant || ''} onChange={(e) => {
                          const arr = [...confiscations.saisiesBancaires];
                          arr[i] = { ...arr[i], montant: parseInt(e.target.value) || 0 };
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                        }} />
                      </div>
                      <div>
                        <Label className="text-xs">Banque</Label>
                        <Input className="text-sm" placeholder="Ex: BNP" value={sb.banque || ''} onChange={(e) => {
                          const arr = [...confiscations.saisiesBancaires];
                          arr[i] = { ...arr[i], banque: e.target.value };
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                        }} />
                      </div>
                      <div className="flex gap-1 items-end">
                        <div className="flex-1">
                          <Label className="text-xs">Réf. AGRASC</Label>
                          <Input className="text-sm" value={sb.referenceAgrasc || ''} onChange={(e) => {
                            const arr = [...confiscations.saisiesBancaires];
                            arr[i] = { ...arr[i], referenceAgrasc: e.target.value };
                            setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                          }} />
                        </div>
                        <Button type="button" variant="destructive" size="sm" onClick={() => {
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: prev.saisiesBancaires.filter((_, j) => j !== i) }));
                        }}>×</Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Cryptomonnaies */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Cryptomonnaies</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() =>
                      setConfiscations(prev => ({ ...prev, cryptomonnaies: [...prev.cryptomonnaies, { montantEur: 0 }] }))
                    }>+ Ajouter</Button>
                  </div>
                  {confiscations.cryptomonnaies.map((cr, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 items-end mb-2 bg-gray-50 p-2 rounded">
                      <div>
                        <Label className="text-xs">Valeur en € (au moment de la saisie)</Label>
                        <Input className="text-sm" type="number" min="0" value={cr.montantEur || ''} onChange={(e) => {
                          const arr = [...confiscations.cryptomonnaies];
                          arr[i] = { ...arr[i], montantEur: parseInt(e.target.value) || 0 };
                          setConfiscations(prev => ({ ...prev, cryptomonnaies: arr }));
                        }} />
                      </div>
                      <div className="flex gap-1 items-end">
                        <div className="flex-1">
                          <Label className="text-xs">Type (BTC, ETH...)</Label>
                          <Input className="text-sm" placeholder="Ex: Bitcoin" value={cr.typeCrypto || ''} onChange={(e) => {
                            const arr = [...confiscations.cryptomonnaies];
                            arr[i] = { ...arr[i], typeCrypto: e.target.value };
                            setConfiscations(prev => ({ ...prev, cryptomonnaies: arr }));
                          }} />
                        </div>
                        <Button type="button" variant="destructive" size="sm" onClick={() => {
                          setConfiscations(prev => ({ ...prev, cryptomonnaies: prev.cryptomonnaies.filter((_, j) => j !== i) }));
                        }}>×</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </details>

            {/* --- Objets mobiliers --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Objets mobiliers ({confiscations.objetsMobiliers.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    objetsMobiliers: [...prev.objetsMobiliers, { categorie: 'electronique' as CategorieObjet, quantite: 1 }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.objetsMobiliers.map((obj, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Catégorie</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={obj.categorie} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], categorie: e.target.value as CategorieObjet };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }}>
                        <option value="electronique">Électronique (TV, téléphone...)</option>
                        <option value="luxe">Luxe (vêtements, montres, bijoux...)</option>
                        <option value="transport_leger">Transport léger (trottinette, vélo...)</option>
                        <option value="informatique">Matériel informatique</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Input className="text-sm" placeholder="Ex: TV Samsung 65 pouces" value={obj.description || ''} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], description: e.target.value };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }} />
                    </div>
                    <div>
                      <Label className="text-xs">Quantité</Label>
                      <Input className="text-sm" type="number" min="1" value={obj.quantite} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], quantite: parseInt(e.target.value) || 1 };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={obj.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.objetsMobiliers];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: prev.objetsMobiliers.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.objetsMobiliers.length === 0 && <p className="text-sm text-gray-400">Aucun objet mobilier saisi</p>}
              </div>
            </details>

            {/* --- Stupéfiants --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg">
                Stupéfiants{' '}
                {confiscations.stupefiants?.produits?.length
                  ? `(${confiscations.stupefiants.produits.length} produit(s))`
                  : ''}
              </summary>
              <div className="p-3">
                <StupefiantsEditor
                  value={confiscations.stupefiants}
                  onChange={(next) => setConfiscations(prev => ({ ...prev, stupefiants: next }))}
                />
              </div>
            </details>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            onClick={handleSubmit}
            disabled={!dateAudience || nbCondamnes === 0 || selectedCodes.length === 0}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>

      <OverboardPinnedAlertModal
        isOpen={showOverboardAlert}
        onClose={() => {
          setShowOverboardAlert(false);
          if (hasSuivi) {
            setShowSuiviAlert(true);
          } else {
            onClose();
          }
        }}
      />

      <SuiviAlertModal
        isOpen={showSuiviAlert}
        onClose={() => {
          setShowSuiviAlert(false);
          onClose();
        }}
        enqueteNumero={enqueteNumero}
        enqueteTags={enqueteTags}
        triggerContext="audience"
        onCreateTodo={onCreateGlobalTodo}
      />
    </Dialog>
  );
};