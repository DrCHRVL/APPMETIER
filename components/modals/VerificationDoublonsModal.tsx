import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Shield, CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronUp,
  Phone, MapPin, ArrowRight, Edit3, Check, X, RefreshCw, Info, Eye, EyeOff
} from 'lucide-react';
import { Enquete, EcouteData, GeolocData } from '@/types/interfaces';
import { ParsedActe } from '@/utils/documents/ServerDocumentScanner';
import {
  DuplicateDetectionService,
  VerificationResult,
  DuplicateMatch,
  CorrectionSuggestion,
  Divergence
} from '@/utils/documents/DuplicateDetectionService';
import { useToast } from '@/contexts/ToastContext';

interface VerificationDoublonsModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
  /** Actes parsés depuis l'analyse de documents */
  parsedActes: ParsedActe[];
  /** Callback pour appliquer les corrections aux actes existants */
  onApplyCorrections: (updates: Partial<Enquete>) => void;
  /** Callback pour continuer avec les actes validés comme nouveaux */
  onContinueWithNew: (newActes: ParsedActe[]) => void;
}

type Tab = 'doublons' | 'corrections' | 'nouveaux';

export const VerificationDoublonsModal = ({
  isOpen,
  onClose,
  enquete,
  parsedActes,
  onApplyCorrections,
  onContinueWithNew,
}: VerificationDoublonsModalProps) => {
  const [activeTab, setActiveTab] = useState<Tab>('doublons');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [acceptedCorrections, setAcceptedCorrections] = useState<Set<string>>(new Set());
  const [dismissedDoublons, setDismissedDoublons] = useState<Set<number>>(new Set());
  const { showToast } = useToast();

  // Résultat de la vérification
  const verification = useMemo<VerificationResult | null>(() => {
    if (!isOpen || parsedActes.length === 0) return null;
    return DuplicateDetectionService.verifyAgainstExisting(parsedActes, enquete);
  }, [isOpen, parsedActes, enquete]);

  // Reset à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setExpandedItems(new Set());
      setAcceptedCorrections(new Set());
      setDismissedDoublons(new Set());
      // Afficher l'onglet le plus pertinent
      if (verification) {
        if (verification.corrections.length > 0) setActiveTab('corrections');
        else if (verification.doublonsConfirmes.length + verification.doublonsProbables.length > 0) setActiveTab('doublons');
        else setActiveTab('nouveaux');
      }
    }
  }, [isOpen, verification]);

  const toggleExpand = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleCorrection = (key: string) => {
    setAcceptedCorrections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Appliquer les corrections sélectionnées
  const handleApplyCorrections = useCallback(() => {
    if (!verification) return;

    const newEcoutes = [...(enquete.ecoutes || [])];
    const newGeolocs = [...(enquete.geolocalisations || [])];
    let nbCorrections = 0;

    for (const correction of verification.corrections) {
      for (const div of correction.corrections) {
        const key = `${correction.acteType}_${correction.acteIndex}_${div.field}`;
        if (!acceptedCorrections.has(key)) continue;

        if (correction.acteType === 'ecoute') {
          const ecoute = { ...newEcoutes[correction.acteIndex] };
          if (div.field === 'dateDebut') {
            ecoute.dateDebut = div.parsedValue;
          } else if (div.field === 'numero') {
            ecoute.numero = div.parsedValue;
          }
          newEcoutes[correction.acteIndex] = ecoute;
          nbCorrections++;
        } else {
          const geoloc = { ...newGeolocs[correction.acteIndex] };
          if (div.field === 'dateDebut') {
            geoloc.dateDebut = div.parsedValue;
          } else if (div.field === 'objet') {
            geoloc.objet = div.parsedValue;
          }
          newGeolocs[correction.acteIndex] = geoloc;
          nbCorrections++;
        }
      }
    }

    if (nbCorrections === 0) {
      showToast('Aucune correction sélectionnée', 'info');
      return;
    }

    const updates: Partial<Enquete> = {};
    if (JSON.stringify(newEcoutes) !== JSON.stringify(enquete.ecoutes || [])) {
      updates.ecoutes = newEcoutes;
    }
    if (JSON.stringify(newGeolocs) !== JSON.stringify(enquete.geolocalisations || [])) {
      updates.geolocalisations = newGeolocs;
    }

    onApplyCorrections(updates);
    showToast(`${nbCorrections} correction(s) appliquée(s)`, 'success');
  }, [verification, acceptedCorrections, enquete, onApplyCorrections, showToast]);

  // Continuer avec les actes nouveaux + les doublons probables reclassés
  const handleContinueWithNew = useCallback(() => {
    if (!verification) return;

    const actesToCreate: ParsedActe[] = [
      ...verification.nouveaux,
      // Inclure les doublons probables que l'utilisateur a explicitement reclassés
      ...verification.doublonsProbables
        .filter((_, i) => dismissedDoublons.has(i))
        .map(d => d.parsed),
    ];

    if (actesToCreate.length === 0) {
      showToast('Aucun acte nouveau à créer', 'info');
      return;
    }

    onContinueWithNew(actesToCreate);
    showToast(`${actesToCreate.length} acte(s) prêt(s) à créer`, 'success');
    onClose();
  }, [verification, dismissedDoublons, onContinueWithNew, onClose, showToast]);

  if (!verification) return null;

  const totalDoublons = verification.doublonsConfirmes.length + verification.doublonsProbables.length;

  // ─── Rendu ───

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Vérification des doublons et corrections
          </DialogTitle>
        </DialogHeader>

        {/* Statistiques */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <button
            onClick={() => setActiveTab('doublons')}
            className={`rounded-lg p-3 text-center transition-colors border-2 ${
              activeTab === 'doublons'
                ? 'border-amber-400 bg-amber-50'
                : 'border-transparent bg-amber-50/50 hover:bg-amber-50'
            }`}
          >
            <p className="text-2xl font-bold text-amber-700">{totalDoublons}</p>
            <p className="text-xs text-amber-600">Doublon(s) détecté(s)</p>
          </button>
          <button
            onClick={() => setActiveTab('corrections')}
            className={`rounded-lg p-3 text-center transition-colors border-2 ${
              activeTab === 'corrections'
                ? 'border-blue-400 bg-blue-50'
                : 'border-transparent bg-blue-50/50 hover:bg-blue-50'
            }`}
          >
            <p className="text-2xl font-bold text-blue-700">{verification.corrections.length}</p>
            <p className="text-xs text-blue-600">Correction(s) suggérée(s)</p>
          </button>
          <button
            onClick={() => setActiveTab('nouveaux')}
            className={`rounded-lg p-3 text-center transition-colors border-2 ${
              activeTab === 'nouveaux'
                ? 'border-green-400 bg-green-50'
                : 'border-transparent bg-green-50/50 hover:bg-green-50'
            }`}
          >
            <p className="text-2xl font-bold text-green-700">{verification.nouveaux.length}</p>
            <p className="text-xs text-green-600">Nouveau(x) acte(s)</p>
          </button>
        </div>

        {/* ── Onglet Doublons ── */}
        {activeTab === 'doublons' && (
          <div className="space-y-3">
            {totalDoublons === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm">Aucun doublon détecté</p>
              </div>
            ) : (
              <>
                {/* Doublons confirmés */}
                {verification.doublonsConfirmes.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2 text-red-700">
                      <XCircle className="h-4 w-4" />
                      Doublons confirmés ({verification.doublonsConfirmes.length})
                    </h3>
                    {verification.doublonsConfirmes.map(({ parsed, match }, i) => (
                      <DoublonCard
                        key={`confirmed-${i}`}
                        parsed={parsed}
                        match={match}
                        type="confirmed"
                        expanded={expandedItems.has(`confirmed-${i}`)}
                        onToggleExpand={() => toggleExpand(`confirmed-${i}`)}
                      />
                    ))}
                  </div>
                )}

                {/* Doublons probables */}
                {verification.doublonsProbables.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="h-4 w-4" />
                      Doublons probables ({verification.doublonsProbables.length})
                      <span className="text-xs font-normal text-gray-500">
                        — cliquez pour reclasser comme nouveau
                      </span>
                    </h3>
                    {verification.doublonsProbables.map(({ parsed, match }, i) => (
                      <DoublonCard
                        key={`probable-${i}`}
                        parsed={parsed}
                        match={match}
                        type="probable"
                        expanded={expandedItems.has(`probable-${i}`)}
                        onToggleExpand={() => toggleExpand(`probable-${i}`)}
                        dismissed={dismissedDoublons.has(i)}
                        onDismiss={() => {
                          setDismissedDoublons(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          });
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Onglet Corrections ── */}
        {activeTab === 'corrections' && (
          <div className="space-y-3">
            {verification.corrections.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm">Aucune correction suggérée</p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-800">
                      Les corrections ci-dessous ont été détectées en comparant les documents analysés
                      avec les actes déjà enregistrés. Sélectionnez celles que vous souhaitez appliquer.
                      <br />
                      <strong>Cas typique :</strong> la date enregistrée est la date de réception de l&apos;acte,
                      alors que le document indique la date d&apos;autorisation (souvent 1 jour avant).
                    </p>
                  </div>
                </div>

                {verification.corrections.map((correction, ci) => (
                  <CorrectionCard
                    key={`correction-${ci}`}
                    correction={correction}
                    expanded={expandedItems.has(`correction-${ci}`)}
                    onToggleExpand={() => toggleExpand(`correction-${ci}`)}
                    acceptedCorrections={acceptedCorrections}
                    onToggleCorrection={toggleCorrection}
                  />
                ))}

                {acceptedCorrections.size > 0 && (
                  <Button
                    onClick={handleApplyCorrections}
                    className="w-full flex items-center justify-center gap-2"
                  >
                    <Edit3 className="h-4 w-4" />
                    Appliquer {acceptedCorrections.size} correction(s)
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Onglet Nouveaux ── */}
        {activeTab === 'nouveaux' && (
          <div className="space-y-3">
            {verification.nouveaux.length === 0 && dismissedDoublons.size === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm">Tous les actes sont des doublons — aucun nouvel acte à créer</p>
              </div>
            ) : (
              <>
                {verification.nouveaux.map((parsed, i) => (
                  <div key={`new-${i}`} className="border border-green-200 bg-green-50/50 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge className="text-xs bg-green-100 text-green-700">
                            {parsed.type.includes('ecoute') ? 'Écoute' : 'Géoloc'}
                          </Badge>
                          <span className="text-sm font-medium">
                            {parsed.cibles.join(', ') || 'Cible non détectée'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Date : {parsed.dateAutorisation} — Source : {parsed.source.fileName}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {dismissedDoublons.size > 0 && (
                  <div className="border-t pt-2">
                    <p className="text-xs text-gray-500 mb-2">
                      + {dismissedDoublons.size} doublon(s) probable(s) reclassé(s) comme nouveau(x)
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {(verification.nouveaux.length > 0 || dismissedDoublons.size > 0) && (
            <Button onClick={handleContinueWithNew} className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Continuer avec {verification.nouveaux.length + dismissedDoublons.size} acte(s) nouveau(x)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Composant DoublonCard ───

interface DoublonCardProps {
  parsed: ParsedActe;
  match: DuplicateMatch;
  type: 'confirmed' | 'probable';
  expanded: boolean;
  onToggleExpand: () => void;
  dismissed?: boolean;
  onDismiss?: () => void;
}

const DoublonCard = ({ parsed, match, type, expanded, onToggleExpand, dismissed, onDismiss }: DoublonCardProps) => {
  const existingLabel = match.existingType === 'ecoute'
    ? (match.existingData as EcouteData).numero
    : (match.existingData as GeolocData).objet;

  const borderColor = dismissed
    ? 'border-green-300 bg-green-50/30'
    : type === 'confirmed'
      ? 'border-red-200 bg-red-50/30'
      : 'border-amber-200 bg-amber-50/30';

  return (
    <div className={`border rounded-lg p-3 ${borderColor}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {match.existingType === 'ecoute'
              ? <Phone className="h-4 w-4 text-blue-500" />
              : <MapPin className="h-4 w-4 text-green-500" />
            }
            <span className="text-sm font-medium">{parsed.cibles.join(', ')}</span>
            <ArrowRight className="h-3 w-3 text-gray-400" />
            <span className="text-sm text-gray-600">{existingLabel}</span>
            <Badge className={`text-xs ${
              match.similarity >= 0.85 ? 'bg-red-100 text-red-700' :
              match.similarity >= 0.55 ? 'bg-amber-100 text-amber-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {Math.round(match.similarity * 100)}%
            </Badge>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Document : {parsed.source.fileName} — Date doc : {parsed.dateAutorisation} / Date enregistrée : {match.existingData.dateDebut}
          </p>
          {match.divergences.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              {match.divergences.length} différence(s) : {match.divergences.map(d => d.label).join(', ')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {type === 'probable' && onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className={`text-xs ${dismissed ? 'text-green-600' : 'text-gray-500'}`}
              title={dismissed ? 'Reclassé comme nouveau' : 'Reclasser comme nouveau'}
            >
              {dismissed ? <Check className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onToggleExpand}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-2 space-y-2">
          <p className="text-xs font-medium text-gray-700">Détail du matching :</p>
          <div className="grid grid-cols-1 gap-1">
            {match.matchDetails.map((detail, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  detail.matchType === 'exact' ? 'bg-green-500' :
                  detail.matchType === 'normalized' ? 'bg-green-400' :
                  detail.matchType === 'partial' ? 'bg-yellow-500' :
                  detail.matchType === 'fuzzy' ? 'bg-amber-500' :
                  'bg-red-500'
                }`} />
                <span className="font-medium w-40">{detail.label} :</span>
                <span className="text-gray-600">
                  {detail.parsedValue} → {detail.existingValue}
                </span>
                <Badge className="text-[10px] ml-auto" variant="outline">
                  {detail.matchType} ({Math.round(detail.score * 100)}%)
                </Badge>
              </div>
            ))}
          </div>

          {match.divergences.length > 0 && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
              <p className="text-xs font-medium text-amber-700">Divergences :</p>
              {match.divergences.map((div, i) => (
                <div key={i} className="text-xs text-amber-800">
                  <span className="font-medium">{div.label}</span> : {div.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Composant CorrectionCard ───

interface CorrectionCardProps {
  correction: CorrectionSuggestion;
  expanded: boolean;
  onToggleExpand: () => void;
  acceptedCorrections: Set<string>;
  onToggleCorrection: (key: string) => void;
}

const CorrectionCard = ({
  correction,
  expanded,
  onToggleExpand,
  acceptedCorrections,
  onToggleCorrection,
}: CorrectionCardProps) => {
  const existingLabel = correction.acteType === 'ecoute'
    ? (correction.existingData as EcouteData).numero
    : (correction.existingData as GeolocData).objet;

  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-3">
      <div className="flex items-center gap-3">
        {correction.acteType === 'ecoute'
          ? <Phone className="h-4 w-4 text-blue-500" />
          : <MapPin className="h-4 w-4 text-green-500" />
        }
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{existingLabel}</span>
            <Badge className="text-xs bg-blue-100 text-blue-700">
              {correction.corrections.length} correction(s)
            </Badge>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Source : {correction.sourceDocument}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggleExpand}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-2 space-y-2">
          {correction.corrections.map((div, i) => {
            const key = `${correction.acteType}_${correction.acteIndex}_${div.field}`;
            const isAccepted = acceptedCorrections.has(key);

            return (
              <div
                key={i}
                className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                  isAccepted ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => onToggleCorrection(key)}
              >
                <input
                  type="checkbox"
                  checked={isAccepted}
                  onChange={() => onToggleCorrection(key)}
                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{div.label}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-red-600 line-through">{div.existingValue}</span>
                    <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span className="text-green-700 font-medium">{div.parsedValue}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{div.reason}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
