import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ChevronLeft } from 'lucide-react';
import { AudienceResultModal } from './AudienceResultModal';
import { OIConfirmationModal } from './OIConfirmationModal';
import { ClassementModal } from './ClassementModal';
import { useAudience } from '@/hooks/useAudience';
import { useToast } from '@/contexts/ToastContext';
import { SuiviAlertModal } from './SuiviAlertModal';
import { OverboardPinnedAlertModal } from './OverboardPinnedAlertModal';
import { Tag, ToDoItem } from '@/types/interfaces';
import { emptyConfiscations, hasAnySaisies, Confiscations } from '@/types/audienceTypes';
import { SaisiesForm } from '../sections/SaisiesForm';

interface ArchiveEnqueteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onArchive: (id: number) => void;
  enqueteId: number;
  misEnCause?: { id: number; nom: string }[];
  enqueteNumero?: string;
  enqueteTags?: Tag[];
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
  isOverboardPinned?: boolean;
}

export const ArchiveEnqueteModal = ({
  isOpen,
  onClose,
  onArchive,
  enqueteId,
  misEnCause = [],
  enqueteNumero = '',
  enqueteTags = [],
  onCreateGlobalTodo,
  isOverboardPinned = false,
}: ArchiveEnqueteModalProps) => {
  const [step, setStep] = useState<'initial' | 'noResults' | 'date'>('initial');
  const [audienceDate, setAudienceDate] = useState('');
  const [deferementDate, setDeferementDate] = useState('');
  const [nombreDeferes, setNombreDeferes] = useState(0);
  const [saisies, setSaisies] = useState<Confiscations>(emptyConfiscations());
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showOIModal, setShowOIModal] = useState(false);
  const [showClassementModal, setShowClassementModal] = useState(false);
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [showOverboardAlert, setShowOverboardAlert] = useState(false);
  const { saveResultat, getResultat } = useAudience();
  const { showToast } = useToast();
  const hasSuivi = enqueteTags.some(t => t.category === 'suivi');

  // Brouillon de saisies déjà enregistré depuis le détail de l'enquête (s'il existe).
  // C'est la même donnée — on la pré-charge pour éviter toute perte/duplication.
  const existingResultat = getResultat(enqueteId);
  const existingSaisies = existingResultat?.saisies;

  // Pré-charge les saisies dès l'ouverture du modal pour les rendre visibles à
  // l'utilisateur (chemin "Audience à venir"). Les autres chemins (Classement, OI,
  // Résultats) lisent directement `existingResultat` au moment de la sauvegarde.
  useEffect(() => {
    if (isOpen && existingSaisies) {
      setSaisies(JSON.parse(JSON.stringify(existingSaisies)));
    }
    // On ne dépend pas d'existingSaisies pour éviter d'écraser les modifs en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleInitialChoice = (hasResults: boolean) => {
    if (hasResults) {
      setShowResultsModal(true);
    } else {
      // Passer à l'étape "noResults"
      setStep('noResults');
    }
  };

  const handleNoResultsChoice = (isOI: boolean, isClassement: boolean = false) => {
    if (isOI) {
      setShowOIModal(true);
    } else if (isClassement) {
      // Ouvrir le modal de classement au lieu de l'ancienne méthode
      setShowClassementModal(true);
    } else {
      setStep('date');
    }
  };

  const handleClassementSave = async (data: { dateClassement: string; motifClassement: string }) => {
    try {
      // Le state local `saisies` reflète le brouillon pré-archivage + les
      // éventuelles modifications faites dans le SaisiesForm avant le choix
      // "Classement". Source de vérité unique au moment de la décision.
      const classementResultat = {
        enqueteId,
        dateAudience: data.dateClassement,
        condamnations: [],
        confiscations: emptyConfiscations(),
        saisies: hasAnySaisies(saisies) ? saisies : undefined,
        isClassement: true,
        motifClassement: data.motifClassement
      };

      // Sauvegarder ce résultat
      await saveResultat(classementResultat);
      
      // Archiver l'enquête
      handleArchiveWithToast(enqueteId);
      setShowClassementModal(false);
      showToast('Enquête classée sans suite', 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors du classement sans suite:', error);
      showToast('Erreur lors du classement sans suite', 'error');
    }
  };

  const handleArchiveWithToast = (id: number) => {
    try {
      onArchive(id);
      showToast('Enquête archivée avec succès', 'success');
      if (hasSuivi) {
        setShowSuiviAlert(true);
      }
    } catch (error) {
      showToast('Erreur lors de l\'archivage', 'error');
    }
  };

  const handleDateSubmit = async () => {
    try {
      // Le state local `saisies` a déjà été pré-rempli depuis l'éventuel brouillon
      // pré-archivage. On écrase donc le brouillon : le flag isPreArchiveSaisies
      // est implicitement remplacé par isAudiencePending dans le record sauvegardé.
      const pendingResultat = {
        enqueteId,
        dateAudience: audienceDate,
        condamnations: [],
        confiscations: emptyConfiscations(),
        saisies: hasAnySaisies(saisies) ? saisies : undefined,
        isAudiencePending: true,
        typeInfraction: "pending",
        dateDefere: deferementDate || undefined,
        nombreDeferes: nombreDeferes > 0 ? nombreDeferes : undefined
      };

      await saveResultat(pendingResultat);
      handleArchiveWithToast(enqueteId);
      showToast('Enquête archivée avec date d\'audience enregistrée', 'success');
      if (isOverboardPinned) {
        setShowOverboardAlert(true);
      } else {
        onClose();
      }
    } catch (error) {
      console.error('Erreur lors de l\'archivage avec date:', error);
      showToast('Erreur lors de l\'archivage', 'error');
    }
  };

  const handleSaveResults = async (resultat: any) => {
    try {
      console.log('Sauvegarde des résultats:', resultat);

      // Vérification des données
      if (!resultat.dateAudience) {
        throw new Error('Date d\'audience manquante');
      }

      // Si AudienceResultModal n'a pas renseigné de saisies, conserver celles du
      // brouillon pré-archivage pour ne pas perdre le travail effectué pendant
      // l'enquête.
      const draftSaisies = getResultat(enqueteId)?.saisies;
      const preservedSaisies = resultat.saisies && hasAnySaisies(resultat.saisies)
        ? resultat.saisies
        : (hasAnySaisies(draftSaisies) ? draftSaisies : undefined);

      // Sauvegarder les résultats (sans écraser la date qui vient du modal)
      await saveResultat({
        ...resultat,
        enqueteId,
        saisies: preservedSaisies,
      });

      // Déclencher une mise à jour des stats
      window.dispatchEvent(new Event('audience-stats-update'));

      // Archiver l'enquête
      handleArchiveWithToast(enqueteId);
      setShowResultsModal(false);
      onClose();
      
      showToast('Résultats enregistrés et enquête archivée', 'success');
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
      showToast('Erreur lors de l\'enregistrement des résultats', 'error');
    }
  };

  // Gestionnaire pour la confirmation de l'OI
  const handleOIConfirm = async (resultat: any) => {
    try {
      // Le state local `saisies` couvre à la fois le brouillon pré-archivage et
      // les éventuelles modifications faites dans le SaisiesForm avant le choix
      // "OI". Le `resultat` venant de OuvertureInformationModal n'inclut pas de
      // saisies — on injecte donc systématiquement celles du modal.
      const preservedSaisies = hasAnySaisies(saisies) ? saisies : undefined;
      await saveResultat({ ...resultat, saisies: preservedSaisies });
      
      // Archiver l'enquête
      handleArchiveWithToast(enqueteId);
      
      // Déclencher une mise à jour des stats
      window.dispatchEvent(new Event('audience-stats-update'));
      
      showToast('Enquête archivée en tant qu\'ouverture d\'information', 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors de l\'archivage OI:', error);
      showToast('Erreur lors de l\'archivage', 'error');
    }
  };

  const handleBack = () => {
    if (step === 'date' || step === 'noResults') {
      setStep('initial');
    }
    setAudienceDate('');
    setDeferementDate('');
    setNombreDeferes(0);
    setSaisies(emptyConfiscations());
  };

  const resetModal = () => {
    setStep('initial');
    setAudienceDate('');
    setDeferementDate('');
    setNombreDeferes(0);
    setSaisies(emptyConfiscations());
    setShowResultsModal(false);
    setShowOIModal(false);
    setShowClassementModal(false);
  };

  // Fonction factice pour la suppression (ne sera jamais appelée dans ce contexte)
  const handleClassementDelete = () => {
    // Cette fonction ne sera jamais appelée car on est en train de créer un classement
    console.warn('Delete appelé dans le contexte de création - cela ne devrait pas arriver');
  };

  return (
    <>
      <Dialog 
        open={isOpen} 
        onOpenChange={(open) => {
          if (!open) {
            resetModal();
            onClose();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-center">
            {step !== 'initial' && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-2"
                onClick={handleBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>Archiver l'enquête</DialogTitle>
          </DialogHeader>

          {step === 'initial' && (
            <div className="space-y-4">
              <p>Avez-vous les résultats d'audience ?</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleInitialChoice(false)}>
                  Non
                </Button>
                <Button onClick={() => handleInitialChoice(true)}>
                  Oui
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'noResults' && (
            <div className="space-y-4">
              <p>Veuillez indiquer le résultat de l'enquête :</p>
              <DialogFooter className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row">
                <Button variant="outline" onClick={() => handleNoResultsChoice(false, true)}>
                  Classement sans suite
                </Button>
                <Button variant="outline" onClick={() => handleNoResultsChoice(false, false)}>
                  Audience à venir
                </Button>
                <Button onClick={() => handleNoResultsChoice(true, false)}>
                  Ouverture d'information
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'date' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Date d'audience</label>
                <Input
                  type="date"
                  value={audienceDate}
                  onChange={(e) => setAudienceDate(e.target.value)}
                  required
                />
              </div>
              
              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-2 block">Défèrement (optionnel)</label>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-600">Date de défèrement</label>
                    <Input
                      type="date"
                      value={deferementDate}
                      onChange={(e) => setDeferementDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Nombre de personnes déférées</label>
                    <Input
                      type="number"
                      min="0"
                      value={nombreDeferes}
                      onChange={(e) => setNombreDeferes(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>

              {/* Saisies (phase enquête) */}
              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-2 block">Saisies effectuées par les services d'enquête (optionnel)</label>
                <p className="text-xs text-gray-500 mb-3">
                  {existingSaisies && hasAnySaisies(existingSaisies)
                    ? 'Saisies déjà renseignées depuis le détail de l\'enquête. Vous pouvez les compléter ici.'
                    : 'Ces données pourront pré-remplir les confiscations au moment des résultats d\'audience.'}
                </p>
                <SaisiesForm saisies={saisies} onChange={setSaisies} />
              </div>

              <DialogFooter>
                <Button
                  onClick={handleDateSubmit}
                  disabled={!audienceDate}
                >
                  Confirmer
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {showResultsModal && (
        <AudienceResultModal
          isOpen={showResultsModal}
          onClose={() => {
            setShowResultsModal(false);
            onClose();
          }}
          enqueteId={enqueteId}
          onSave={handleSaveResults}
          misEnCause={misEnCause}
          enqueteNumero={enqueteNumero}
          enqueteTags={enqueteTags}
          onCreateGlobalTodo={onCreateGlobalTodo}
          isOverboardPinned={isOverboardPinned}
          initialData={existingResultat || undefined}
        />
      )}

      {showOIModal && (
        <OIConfirmationModal
          isOpen={showOIModal}
          onClose={() => {
            setShowOIModal(false);
            onClose();
          }}
          enqueteId={enqueteId}
          onConfirm={handleOIConfirm}
        />
      )}

      {showClassementModal && (
        <ClassementModal
          isOpen={showClassementModal}
          onClose={() => {
            setShowClassementModal(false);
            onClose();
          }}
          enqueteId={enqueteId}
          initialDate={new Date().toISOString().split('T')[0]} // Date du jour
          initialMotif=""
          onSave={handleClassementSave}
          onDelete={handleClassementDelete} // Fonction factice, ne sera jamais appelée
        />
      )}

      <OverboardPinnedAlertModal
        isOpen={showOverboardAlert}
        onClose={() => {
          setShowOverboardAlert(false);
          onClose();
        }}
      />

      <SuiviAlertModal
        isOpen={showSuiviAlert}
        onClose={() => setShowSuiviAlert(false)}
        enqueteNumero={enqueteNumero}
        enqueteTags={enqueteTags}
        triggerContext="archive"
        onCreateTodo={onCreateGlobalTodo}
      />
    </>
  );
};