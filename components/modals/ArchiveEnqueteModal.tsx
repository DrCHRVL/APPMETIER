import React, { useState } from 'react';
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
import { Tag, ToDoItem } from '@/types/interfaces';
import { emptyConfiscations, Confiscations, VehiculeSaisi, ImmeubleSaisi, SaisieBancaire, CryptoSaisie, ObjetMobilier, TypeVehicule, TypeImmeuble, CategorieObjet, TypeStupefiant } from '@/types/audienceTypes';
import { Label } from '../ui/label';

interface ArchiveEnqueteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onArchive: (id: number) => void;
  enqueteId: number;
  misEnCause?: { id: number; nom: string }[];
  enqueteNumero?: string;
  enqueteTags?: Tag[];
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
}

export const ArchiveEnqueteModal = ({
  isOpen,
  onClose,
  onArchive,
  enqueteId,
  misEnCause = [],
  enqueteNumero = '',
  enqueteTags = [],
  onCreateGlobalTodo
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
  const { saveResultat } = useAudience();
  const { showToast } = useToast();
  const hasSuivi = enqueteTags.some(t => t.category === 'suivi');

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
      // Créer un résultat "classement sans suite"
      const classementResultat = {
        enqueteId,
        dateAudience: data.dateClassement,
        condamnations: [],
        confiscations: emptyConfiscations(),
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
      // Vérifier si des saisies ont été renseignées
      const hasSaisies = saisies.vehicules.length > 0 || saisies.immeubles.length > 0 ||
        saisies.numeraire > 0 || saisies.saisiesBancaires.length > 0 ||
        saisies.cryptomonnaies.length > 0 || saisies.objetsMobiliers.length > 0 ||
        (saisies.stupefiants?.types?.length ?? 0) > 0;

      const pendingResultat = {
        enqueteId,
        dateAudience: audienceDate,
        condamnations: [],
        confiscations: emptyConfiscations(),
        saisies: hasSaisies ? saisies : undefined,
        isAudiencePending: true,
        typeInfraction: "pending",
        dateDefere: deferementDate || undefined,
        nombreDeferes: nombreDeferes > 0 ? nombreDeferes : undefined
      };

      await saveResultat(pendingResultat);
      handleArchiveWithToast(enqueteId);
      showToast('Enquête archivée avec date d\'audience enregistrée', 'success');
      onClose();
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

      // Sauvegarder les résultats (sans écraser la date qui vient du modal)
      await saveResultat({
        ...resultat,
        enqueteId
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
      // Sauvegarder les résultats avec le flag OI
      await saveResultat(resultat);
      
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
                <p className="text-xs text-gray-500 mb-3">Ces données pourront pré-remplir les confiscations au moment des résultats d'audience.</p>

                {/* Véhicules */}
                <details className="mb-3 border rounded-lg">
                  <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                    <span>Véhicules ({saisies.vehicules.length})</span>
                    <Button type="button" variant="outline" size="sm" onClick={(e) => {
                      e.preventDefault();
                      setSaisies(prev => ({ ...prev, vehicules: [...prev.vehicules, { type: 'voiture' as TypeVehicule }] }));
                    }}>+ Ajouter</Button>
                  </summary>
                  <div className="p-2 space-y-2">
                    {saisies.vehicules.map((v, i) => (
                      <div key={i} className="grid grid-cols-4 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
                        <div>
                          <Label className="text-xs">Type</Label>
                          <select className="w-full p-1.5 border rounded text-sm" value={v.type} onChange={(e) => {
                            const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], type: e.target.value as TypeVehicule };
                            setSaisies(prev => ({ ...prev, vehicules: arr }));
                          }}>
                            <option value="voiture">Voiture</option><option value="moto">Moto</option>
                            <option value="scooter">Scooter</option><option value="utilitaire">Utilitaire</option>
                            <option value="poids_lourd">Poids lourd</option><option value="bateau">Bateau</option>
                            <option value="autre">Autre</option>
                          </select>
                        </div>
                        <div><Label className="text-xs">Marque</Label><Input className="text-sm" value={v.marqueModele || ''} onChange={(e) => { const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], marqueModele: e.target.value }; setSaisies(prev => ({ ...prev, vehicules: arr })); }} /></div>
                        <div><Label className="text-xs">Immatriculation</Label><Input className="text-sm" value={v.immatriculation || ''} onChange={(e) => { const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], immatriculation: e.target.value }; setSaisies(prev => ({ ...prev, vehicules: arr })); }} /></div>
                        <div className="flex gap-1 items-end">
                          <div className="flex-1"><Label className="text-xs">Valeur (€)</Label><Input className="text-sm" type="number" min="0" value={v.valeurEstimee || ''} onChange={(e) => { const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined }; setSaisies(prev => ({ ...prev, vehicules: arr })); }} /></div>
                          <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, vehicules: prev.vehicules.filter((_, j) => j !== i) }))}>×</Button>
                        </div>
                      </div>
                    ))}
                    {saisies.vehicules.length === 0 && <p className="text-xs text-gray-400">Aucun véhicule saisi</p>}
                  </div>
                </details>

                {/* Immeubles */}
                <details className="mb-3 border rounded-lg">
                  <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                    <span>Immeubles ({saisies.immeubles.length})</span>
                    <Button type="button" variant="outline" size="sm" onClick={(e) => {
                      e.preventDefault();
                      setSaisies(prev => ({ ...prev, immeubles: [...prev.immeubles, { type: 'appartement' as TypeImmeuble }] }));
                    }}>+ Ajouter</Button>
                  </summary>
                  <div className="p-2 space-y-2">
                    {saisies.immeubles.map((im, i) => (
                      <div key={i} className="grid grid-cols-3 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
                        <div>
                          <Label className="text-xs">Type</Label>
                          <select className="w-full p-1.5 border rounded text-sm" value={im.type} onChange={(e) => {
                            const arr = [...saisies.immeubles]; arr[i] = { ...arr[i], type: e.target.value as TypeImmeuble };
                            setSaisies(prev => ({ ...prev, immeubles: arr }));
                          }}>
                            <option value="appartement">Appartement</option><option value="maison">Maison</option>
                            <option value="terrain">Terrain</option><option value="local_commercial">Local commercial</option>
                            <option value="autre">Autre</option>
                          </select>
                        </div>
                        <div><Label className="text-xs">Adresse</Label><Input className="text-sm" value={im.adresse || ''} onChange={(e) => { const arr = [...saisies.immeubles]; arr[i] = { ...arr[i], adresse: e.target.value }; setSaisies(prev => ({ ...prev, immeubles: arr })); }} /></div>
                        <div className="flex gap-1 items-end">
                          <div className="flex-1"><Label className="text-xs">Valeur (€)</Label><Input className="text-sm" type="number" min="0" value={im.valeurEstimee || ''} onChange={(e) => { const arr = [...saisies.immeubles]; arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined }; setSaisies(prev => ({ ...prev, immeubles: arr })); }} /></div>
                          <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, immeubles: prev.immeubles.filter((_, j) => j !== i) }))}>×</Button>
                        </div>
                      </div>
                    ))}
                    {saisies.immeubles.length === 0 && <p className="text-xs text-gray-400">Aucun immeuble saisi</p>}
                  </div>
                </details>

                {/* Avoirs financiers */}
                <details className="mb-3 border rounded-lg">
                  <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg">Avoirs financiers</summary>
                  <div className="p-2 space-y-3">
                    <div>
                      <Label className="text-xs">Numéraire (espèces) (€)</Label>
                      <Input type="number" min="0" className="text-sm" value={saisies.numeraire || ''} onChange={(e) => setSaisies(prev => ({ ...prev, numeraire: parseInt(e.target.value) || 0 }))} />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <Label className="text-xs">Saisies bancaires</Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSaisies(prev => ({ ...prev, saisiesBancaires: [...prev.saisiesBancaires, { montant: 0 }] }))}>+ Ajouter</Button>
                      </div>
                      {saisies.saisiesBancaires.map((sb, i) => (
                        <div key={i} className="grid grid-cols-3 gap-1 items-end mb-1 bg-gray-50 p-2 rounded text-sm">
                          <div><Label className="text-xs">Montant (€)</Label><Input className="text-sm" type="number" min="0" value={sb.montant || ''} onChange={(e) => { const arr = [...saisies.saisiesBancaires]; arr[i] = { ...arr[i], montant: parseInt(e.target.value) || 0 }; setSaisies(prev => ({ ...prev, saisiesBancaires: arr })); }} /></div>
                          <div><Label className="text-xs">Banque</Label><Input className="text-sm" value={sb.banque || ''} onChange={(e) => { const arr = [...saisies.saisiesBancaires]; arr[i] = { ...arr[i], banque: e.target.value }; setSaisies(prev => ({ ...prev, saisiesBancaires: arr })); }} /></div>
                          <div className="flex gap-1 items-end">
                            <div className="flex-1"><Label className="text-xs">Réf. AGRASC</Label><Input className="text-sm" value={sb.referenceAgrasc || ''} onChange={(e) => { const arr = [...saisies.saisiesBancaires]; arr[i] = { ...arr[i], referenceAgrasc: e.target.value }; setSaisies(prev => ({ ...prev, saisiesBancaires: arr })); }} /></div>
                            <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, saisiesBancaires: prev.saisiesBancaires.filter((_, j) => j !== i) }))}>×</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <Label className="text-xs">Cryptomonnaies</Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSaisies(prev => ({ ...prev, cryptomonnaies: [...prev.cryptomonnaies, { montantEur: 0 }] }))}>+ Ajouter</Button>
                      </div>
                      {saisies.cryptomonnaies.map((cr, i) => (
                        <div key={i} className="grid grid-cols-2 gap-1 items-end mb-1 bg-gray-50 p-2 rounded text-sm">
                          <div><Label className="text-xs">Valeur (€)</Label><Input className="text-sm" type="number" min="0" value={cr.montantEur || ''} onChange={(e) => { const arr = [...saisies.cryptomonnaies]; arr[i] = { ...arr[i], montantEur: parseInt(e.target.value) || 0 }; setSaisies(prev => ({ ...prev, cryptomonnaies: arr })); }} /></div>
                          <div className="flex gap-1 items-end">
                            <div className="flex-1"><Label className="text-xs">Type</Label><Input className="text-sm" placeholder="BTC, ETH..." value={cr.typeCrypto || ''} onChange={(e) => { const arr = [...saisies.cryptomonnaies]; arr[i] = { ...arr[i], typeCrypto: e.target.value }; setSaisies(prev => ({ ...prev, cryptomonnaies: arr })); }} /></div>
                            <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, cryptomonnaies: prev.cryptomonnaies.filter((_, j) => j !== i) }))}>×</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>

                {/* Objets mobiliers */}
                <details className="mb-3 border rounded-lg">
                  <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                    <span>Objets mobiliers ({saisies.objetsMobiliers.length})</span>
                    <Button type="button" variant="outline" size="sm" onClick={(e) => {
                      e.preventDefault();
                      setSaisies(prev => ({ ...prev, objetsMobiliers: [...prev.objetsMobiliers, { categorie: 'electronique' as CategorieObjet, quantite: 1 }] }));
                    }}>+ Ajouter</Button>
                  </summary>
                  <div className="p-2 space-y-2">
                    {saisies.objetsMobiliers.map((obj, i) => (
                      <div key={i} className="grid grid-cols-4 gap-1 items-end bg-gray-50 p-2 rounded text-sm">
                        <div>
                          <Label className="text-xs">Catégorie</Label>
                          <select className="w-full p-1.5 border rounded text-sm" value={obj.categorie} onChange={(e) => {
                            const arr = [...saisies.objetsMobiliers]; arr[i] = { ...arr[i], categorie: e.target.value as CategorieObjet };
                            setSaisies(prev => ({ ...prev, objetsMobiliers: arr }));
                          }}>
                            <option value="electronique">Électronique</option><option value="luxe">Luxe</option>
                            <option value="transport_leger">Transport léger</option><option value="informatique">Informatique</option>
                            <option value="autre">Autre</option>
                          </select>
                        </div>
                        <div><Label className="text-xs">Description</Label><Input className="text-sm" value={obj.description || ''} onChange={(e) => { const arr = [...saisies.objetsMobiliers]; arr[i] = { ...arr[i], description: e.target.value }; setSaisies(prev => ({ ...prev, objetsMobiliers: arr })); }} /></div>
                        <div><Label className="text-xs">Quantité</Label><Input className="text-sm" type="number" min="1" value={obj.quantite} onChange={(e) => { const arr = [...saisies.objetsMobiliers]; arr[i] = { ...arr[i], quantite: parseInt(e.target.value) || 1 }; setSaisies(prev => ({ ...prev, objetsMobiliers: arr })); }} /></div>
                        <div className="flex gap-1 items-end">
                          <div className="flex-1"><Label className="text-xs">Valeur (€)</Label><Input className="text-sm" type="number" min="0" value={obj.valeurEstimee || ''} onChange={(e) => { const arr = [...saisies.objetsMobiliers]; arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined }; setSaisies(prev => ({ ...prev, objetsMobiliers: arr })); }} /></div>
                          <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, objetsMobiliers: prev.objetsMobiliers.filter((_, j) => j !== i) }))}>×</Button>
                        </div>
                      </div>
                    ))}
                    {saisies.objetsMobiliers.length === 0 && <p className="text-xs text-gray-400">Aucun objet</p>}
                  </div>
                </details>

                {/* Stupéfiants */}
                <details className="mb-3 border rounded-lg">
                  <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 rounded-t-lg">
                    Stupéfiants {saisies.stupefiants?.types?.length ? `(${saisies.stupefiants.types.length} type(s))` : ''}
                  </summary>
                  <div className="p-2 space-y-2">
                    <div className="grid grid-cols-2 gap-1">
                      {([['cocaine', 'Cocaïne'], ['heroine', 'Héroïne'], ['cannabis', 'Cannabis'], ['synthese', 'Drogues de synthèse'], ['autre', 'Autre']] as [TypeStupefiant, string][]).map(([val, label]) => (
                        <label key={val} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded border-gray-300"
                            checked={saisies.stupefiants?.types?.includes(val) || false}
                            onChange={(e) => {
                              const current = saisies.stupefiants?.types || [];
                              const newTypes = e.target.checked ? [...current, val] : current.filter(t => t !== val);
                              setSaisies(prev => ({ ...prev, stupefiants: newTypes.length > 0 ? { ...prev.stupefiants, types: newTypes, quantite: prev.stupefiants?.quantite, description: prev.stupefiants?.description } : undefined }));
                            }} />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                    {saisies.stupefiants?.types?.length ? (
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <div><Label className="text-xs">Quantité</Label><Input className="text-sm" placeholder="Ex: 5 kg" value={saisies.stupefiants?.quantite || ''} onChange={(e) => setSaisies(prev => ({ ...prev, stupefiants: { ...prev.stupefiants!, quantite: e.target.value } }))} /></div>
                        <div><Label className="text-xs">Description</Label><Input className="text-sm" placeholder="Détails..." value={saisies.stupefiants?.description || ''} onChange={(e) => setSaisies(prev => ({ ...prev, stupefiants: { ...prev.stupefiants!, description: e.target.value } }))} /></div>
                      </div>
                    ) : null}
                  </div>
                </details>
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