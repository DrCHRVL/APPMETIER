import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { useAudience } from '@/hooks/useAudience';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { ResultatAudience, migrateConfiscations } from '@/types/audienceTypes';
import { AudienceResultModal } from './AudienceResultModal';
import { ClassementModal } from './ClassementModal';

interface ViewAudienceResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  enqueteId: number;
  onReset?: () => void;
  onUpdate?: (resultat: ResultatAudience) => void;
}

export const ViewAudienceResultModal = ({
  isOpen,
  onClose,
  enqueteId,
  onReset,
  onUpdate
}: ViewAudienceResultModalProps) => {
  const { getResultat, isLoading, saveResultat, deleteAudienceResultat } = useAudience();
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [showClassementModal, setShowClassementModal] = useState(false);

  const handleReset = () => {
    try {
      if (onReset) {
        onReset();
        showToast('Résultats supprimés avec succès', 'success');
        onClose();
      }
    } catch (error) {
      showToast('Erreur lors de la suppression des résultats', 'error');
    }
  };

  const handleEdit = () => {
    const resultat = getResultat(enqueteId);
    
    // Si c'est un classement, ouvrir le modal spécialisé
    if (resultat?.isClassement) {
      setShowClassementModal(true);
    } else {
      setIsEditing(true);
    }
  };

  const handleUpdateSubmit = async (updatedResult: ResultatAudience) => {
    try {
      const compatibleResult = {
        ...updatedResult,
        confiscations: migrateConfiscations(updatedResult.confiscations),
        condamnations: updatedResult.condamnations.map(condamnation => ({
          nom: condamnation.nom || '',
          peinePrison: condamnation.peinePrison || 0,
          sursisProbatoire: condamnation.sursisProbatoire || 0,
          sursisSimple: condamnation.sursisSimple || 0,
          peineAmende: condamnation.peineAmende || 0,
          interdictionParaitre: condamnation.interdictionParaitre || false,
          typeAudience: condamnation.typeAudience || 'CRPC-Def',
          defere: condamnation.defere || false
        }))
      };

      // Sauvegarde dans le stockage
      await saveResultat(compatibleResult);
      
      // Mise à jour de l'UI parent si nécessaire
      if (onUpdate) {
        onUpdate(compatibleResult);
      }
      
      setIsEditing(false);
      showToast('Résultats mis à jour avec succès', 'success');
      onClose();
    } catch (error) {
      showToast('Erreur lors de la mise à jour des résultats', 'error');
    }
  };

  const handleClassementUpdate = async (data: { dateClassement: string; motifClassement: string }) => {
    try {
      const resultat = getResultat(enqueteId);
      if (!resultat) return;

      const updatedResult = {
        ...resultat,
        dateAudience: data.dateClassement, // Utiliser la nouvelle date
        motifClassement: data.motifClassement
      };

      await saveResultat(updatedResult);
      
      if (onUpdate) {
        onUpdate(updatedResult);
      }
      
      setShowClassementModal(false);
      showToast('Classement mis à jour avec succès', 'success');
      onClose();
    } catch (error) {
      showToast('Erreur lors de la mise à jour du classement', 'error');
    }
  };

  const handleClassementDelete = async () => {
    try {
      await deleteAudienceResultat(enqueteId);
      setShowClassementModal(false);
      showToast('Classement supprimé avec succès', 'success');
      onClose();
    } catch (error) {
      showToast('Erreur lors de la suppression du classement', 'error');
    }
  };

  if (isLoading) {
    return null;
  }

  const resultat = getResultat(enqueteId);
  if (!resultat) return null;

  if (isEditing) {
    return (
      <AudienceResultModal
        isOpen={true}
        onClose={() => {
          setIsEditing(false);
          onClose();
        }}
        onSave={handleUpdateSubmit}
        enqueteId={enqueteId}
        defaultDate={resultat.dateAudience}
        initialData={resultat}
      />
    );
  }

  if (showClassementModal) {
    return (
      <ClassementModal
        isOpen={true}
        onClose={() => {
          setShowClassementModal(false);
          onClose();
        }}
        enqueteId={enqueteId}
        initialDate={resultat.dateAudience}
        initialMotif={resultat.motifClassement || ''}
        onSave={handleClassementUpdate}
        onDelete={handleClassementDelete}
      />
    );
  }

  const formatDate = (date: string) => {
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });
    } catch (error) {
      console.error("Erreur lors du formatage de la date :", error);
      return '';
    }
  };

  // Vérifier si c'est une ouverture d'information
  const isOI = resultat.isOI === true;
  
  // Vérifier si c'est une audience en attente
  const isPending = resultat.isAudiencePending === true;

  // Vérifier si c'est un classement
  const isClassement = resultat.isClassement === true;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isOI ? 'Ouverture d\'information' : 
             isPending ? 'Audience prévue' : 
             isClassement ? 'Classement sans suite' :
             'Résultats d\'audience'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {resultat.dateAudience && (
            <div>
              {isOI ? (
                <div className="bg-purple-100 p-4 rounded-lg mb-4">
                  <p className="font-medium text-purple-800">
                    Cette enquête a été ouverte à l'information judiciaire le {new Date(resultat.dateAudience).toLocaleDateString()}
                    <span className="ml-2">({formatDate(resultat.dateAudience)})</span>
                  </p>
                </div>
              ) : isPending ? (
                <div className="bg-blue-100 p-4 rounded-lg mb-4">
                  <p className="font-medium text-blue-800">
                    Audience prévue le {new Date(resultat.dateAudience).toLocaleDateString()}
                    <span className="ml-2">({formatDate(resultat.dateAudience)})</span>
                  </p>
                </div>
              ) : isClassement ? (
                <div className="bg-red-100 p-4 rounded-lg mb-4">
                  <p className="font-medium text-red-800">
                    Classement sans suite le {new Date(resultat.dateAudience).toLocaleDateString()}
                    <span className="ml-2">({formatDate(resultat.dateAudience)})</span>
                  </p>
                  {resultat.motifClassement && (
                    <p className="text-sm text-red-700 mt-2">
                      <strong>Motif :</strong> {resultat.motifClassement}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Date d'audience : {new Date(resultat.dateAudience).toLocaleDateString()}
                  <span className="ml-2">({formatDate(resultat.dateAudience)})</span>
                </p>
              )}
            </div>
          )}

          {!isOI && !isPending && !isClassement && (
            <>
              <div className="space-y-4">
                <h3 className="font-medium">Condamnations ({resultat.condamnations.length})</h3>
                {resultat.condamnations.map((condamnation, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">{condamnation.nom ? condamnation.nom : `Condamné ${index + 1}`}</h4>
                    
                    {/* Type d'audience et déférement pour chaque condamné */}
                    <div className="mb-2 text-sm text-gray-600">
                      <div>Type d'audience: {condamnation.typeAudience}</div>
                      {condamnation.defere && <div>Défèrement</div>}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {condamnation.peinePrison > 0 && (
                        <div>
                          <span className="text-gray-600">Prison ferme:</span>
                          <span className="font-medium ml-2">{condamnation.peinePrison} mois</span>
                        </div>
                      )}
                      {condamnation.sursisProbatoire > 0 && (
                        <div>
                          <span className="text-gray-600">Sursis probatoire:</span>
                          <span className="font-medium ml-2">{condamnation.sursisProbatoire} mois</span>
                        </div>
                      )}
                      {condamnation.sursisSimple > 0 && (
                        <div>
                          <span className="text-gray-600">Sursis simple:</span>
                          <span className="font-medium ml-2">{condamnation.sursisSimple} mois</span>
                        </div>
                      )}
                      {condamnation.peineAmende > 0 && (
                        <div>
                          <span className="text-gray-600">Amende:</span>
                          <span className="font-medium ml-2">
                            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
                              .format(condamnation.peineAmende)}
                          </span>
                        </div>
                      )}
                      {condamnation.interdictionParaitre && (
                        <div className="col-span-2">
                          <span className="text-gray-600">Interdiction de paraître</span>
                          <span className="ml-2">Oui</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <h3 className="font-medium">Confiscations et saisies</h3>
                {(() => {
                  const conf = migrateConfiscations(resultat.confiscations);
                  const formatEur = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
                  const totalBancaire = conf.saisiesBancaires.reduce((s, b) => s + b.montant, 0);
                  const totalCrypto = conf.cryptomonnaies.reduce((s, c) => s + c.montantEur, 0);
                  const hasContent = conf.vehicules.length > 0 || conf.immeubles.length > 0 || conf.numeraire > 0 || conf.saisiesBancaires.length > 0 || conf.cryptomonnaies.length > 0 || conf.objetsMobiliers.length > 0 || conf.stupefiants?.types?.length;
                  if (!hasContent) return <p className="text-sm text-gray-400">Aucune saisie enregistrée</p>;
                  const typeVehLabels: Record<string, string> = { voiture: 'Voiture', moto: 'Moto', scooter: 'Scooter', utilitaire: 'Utilitaire', poids_lourd: 'Poids lourd', bateau: 'Bateau', autre: 'Autre' };
                  const typeImmLabels: Record<string, string> = { appartement: 'Appartement', maison: 'Maison', terrain: 'Terrain', local_commercial: 'Local commercial', autre: 'Autre' };
                  const catObjLabels: Record<string, string> = { electronique: 'Électronique', luxe: 'Luxe', transport_leger: 'Transport léger', informatique: 'Informatique', autre: 'Autre' };
                  const stupLabels: Record<string, string> = { cocaine: 'Cocaïne', heroine: 'Héroïne', cannabis: 'Cannabis', synthese: 'Synthèse', autre: 'Autre' };
                  return (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                      {conf.vehicules.length > 0 && (
                        <div>
                          <span className="text-gray-600 font-medium">Véhicules ({conf.vehicules.length}) :</span>
                          <ul className="ml-4 mt-1 space-y-1">
                            {conf.vehicules.map((v, i) => (
                              <li key={i}>{typeVehLabels[v.type] || v.type}{v.marqueModele ? ` - ${v.marqueModele}` : ''}{v.immatriculation ? ` (${v.immatriculation})` : ''}{v.valeurEstimee ? ` — ${formatEur(v.valeurEstimee)}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {conf.immeubles.length > 0 && (
                        <div>
                          <span className="text-gray-600 font-medium">Immeubles ({conf.immeubles.length}) :</span>
                          <ul className="ml-4 mt-1 space-y-1">
                            {conf.immeubles.map((im, i) => (
                              <li key={i}>{typeImmLabels[im.type] || im.type}{im.adresse ? ` - ${im.adresse}` : ''}{im.valeurEstimee ? ` — ${formatEur(im.valeurEstimee)}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {conf.numeraire > 0 && (
                        <div><span className="text-gray-600">Numéraire (espèces) :</span> <span className="font-medium">{formatEur(conf.numeraire)}</span></div>
                      )}
                      {conf.saisiesBancaires.length > 0 && (
                        <div>
                          <span className="text-gray-600 font-medium">Saisies bancaires ({formatEur(totalBancaire)}) :</span>
                          <ul className="ml-4 mt-1 space-y-1">
                            {conf.saisiesBancaires.map((sb, i) => (
                              <li key={i}>{formatEur(sb.montant)}{sb.banque ? ` (${sb.banque})` : ''}{sb.referenceAgrasc ? ` — AGRASC: ${sb.referenceAgrasc}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {conf.cryptomonnaies.length > 0 && (
                        <div>
                          <span className="text-gray-600 font-medium">Cryptomonnaies ({formatEur(totalCrypto)}) :</span>
                          <ul className="ml-4 mt-1 space-y-1">
                            {conf.cryptomonnaies.map((cr, i) => (
                              <li key={i}>{formatEur(cr.montantEur)}{cr.typeCrypto ? ` (${cr.typeCrypto})` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {conf.objetsMobiliers.length > 0 && (
                        <div>
                          <span className="text-gray-600 font-medium">Objets mobiliers ({conf.objetsMobiliers.length}) :</span>
                          <ul className="ml-4 mt-1 space-y-1">
                            {conf.objetsMobiliers.map((obj, i) => (
                              <li key={i}>{catObjLabels[obj.categorie] || obj.categorie}{obj.description ? ` - ${obj.description}` : ''} ×{obj.quantite}{obj.valeurEstimee ? ` — ${formatEur(obj.valeurEstimee)}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {conf.stupefiants?.types?.length ? (
                        <div>
                          <span className="text-gray-600 font-medium">Stupéfiants :</span>
                          <span className="ml-1">{conf.stupefiants.types.map(t => stupLabels[t] || t).join(', ')}</span>
                          {conf.stupefiants.quantite && <span className="ml-2">— {conf.stupefiants.quantite}</span>}
                          {conf.stupefiants.description && <span className="ml-2 text-gray-500">({conf.stupefiants.description})</span>}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </>
          )}

          <DialogFooter>
            <div className="space-x-2">
              <Button variant="outline" onClick={handleEdit}>
                Modifier
              </Button>
              {onReset && !isClassement && (
                <Button variant="destructive" onClick={handleReset}>
                  Supprimer les résultats
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};