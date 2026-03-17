import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Search, Loader, CheckCircle, XCircle, AlertTriangle, Phone, MapPin,
  FileText, ChevronDown, ChevronUp, Eye, EyeOff, ArrowRight, Info, Shield
} from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { ServerDocumentScanner, ParsedActe, AnalysisResult, ScannedDocument, AlerteDocumentManquant } from '@/utils/documents/ServerDocumentScanner';
import { VerificationDoublonsModal } from './VerificationDoublonsModal';
import { useToast } from '@/contexts/ToastContext';

interface AnalyseDocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
  onApplyActes: (updates: Partial<Enquete>) => void;
}

type Phase = 'idle' | 'scanning' | 'analyzing' | 'results';

export const AnalyseDocumentsModal = ({
  isOpen,
  onClose,
  enquete,
  onApplyActes
}: AnalyseDocumentsModalProps) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selectedActes, setSelectedActes] = useState<Set<number>>(new Set());
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(new Set());
  const [showDoublons, setShowDoublons] = useState(false);
  const [showNonReconnus, setShowNonReconnus] = useState(false);
  const [showAlertes, setShowAlertes] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showVerification, setShowVerification] = useState(false);

  const { showToast } = useToast();

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setPhase('idle');
      setResult(null);
      setSelectedActes(new Set());
      setExpandedDetails(new Set());
      setScanError(null);
    }
  }, [isOpen]);

  // Lancer l'analyse
  const startAnalysis = useCallback(async () => {
    if (!enquete.cheminExterne) {
      setScanError('Aucun chemin externe configuré. Configurez le chemin dans la section Documents.');
      return;
    }

    if (!window.electronAPI?.scanExternalPDFs) {
      setScanError('API non disponible. Fonctionnalité requiert Electron.');
      return;
    }

    setPhase('scanning');
    setProgress('Scan des dossiers en cours...');
    setScanError(null);

    try {
      // 1. Scanner les PDF du chemin externe
      const scanResult = await window.electronAPI.scanExternalPDFs(
        enquete.cheminExterne,
        enquete.numero,
        enquete.useSubfolderForExternal !== false
      );

      if (scanResult.errors.length > 0) {
        console.warn('Erreurs de scan:', scanResult.errors);
        // Afficher les erreurs de scan non-bloquantes en toast
        if (scanResult.documents.length > 0) {
          showToast(
            `${scanResult.errors.length} erreur(s) lors du scan, mais ${scanResult.documents.length} PDF ont pu être lus`,
            'warning'
          );
        }
      }

      if (scanResult.documents.length === 0) {
        const foldersList = scanResult.foldersScanned.join(', ') || 'aucun dossier trouvé';
        let errorMsg = `Aucun PDF exploitable trouvé.\n\nDossiers scannés : ${foldersList}`;

        if (scanResult.foldersScanned.length === 0) {
          errorMsg += '\n\nLe chemin externe ne contient aucun sous-dossier. Vérifiez que le chemin pointe vers le bon dossier d\'enquête.';
        }

        if (scanResult.errors.length > 0) {
          errorMsg += `\n\nErreurs rencontrées :\n• ${scanResult.errors.join('\n• ')}`;
        }

        setScanError(errorMsg);
        setPhase('idle');
        return;
      }

      setPhase('analyzing');
      setProgress(`Analyse de ${scanResult.documents.length} PDF en cours...`);

      // 2. Analyser les documents
      const scannedDocs: ScannedDocument[] = scanResult.documents;
      const analysisResult = await ServerDocumentScanner.analyzeExternalDocuments(
        enquete,
        scannedDocs
      );

      // Ajouter les infos de dossiers scannés
      analysisResult.stats.foldersScanned = scanResult.foldersScanned;

      // Pré-sélectionner les actes avec haute confiance et sans erreurs
      const preSelected = new Set<number>();
      analysisResult.actesDetectes.forEach((acte, index) => {
        if (acte.confidence >= 0.6 && acte.errors.length === 0) {
          preSelected.add(index);
        }
      });
      setSelectedActes(preSelected);

      setResult(analysisResult);
      setPhase('results');

      // Toast récapitulatif
      if (analysisResult.actesDetectes.length > 0) {
        showToast(
          `${analysisResult.actesDetectes.length} acte(s) détecté(s) sur ${scanResult.documents.length} PDF. ` +
          `${preSelected.size} pré-sélectionné(s). Vérifiez et validez.`,
          'success'
        );
      } else if (analysisResult.stats.totalDoublons > 0) {
        showToast(
          `Tous les actes détectés sont des doublons (${analysisResult.stats.totalDoublons}). Aucun nouvel acte à créer.`,
          'info'
        );
      } else {
        showToast(
          `Aucun acte reconnu dans les ${scanResult.documents.length} PDF analysés.`,
          'info'
        );
      }

    } catch (error) {
      console.error('Erreur analyse:', error);
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      setScanError(
        `Erreur lors de l'analyse :\n${msg}\n\n` +
        `Si le problème persiste, vérifiez que le chemin externe est accessible et que les PDF ne sont pas corrompus.`
      );
      showToast('Erreur lors de l\'analyse des documents', 'error');
      setPhase('idle');
    }
  }, [enquete]);

  // Appliquer les actes sélectionnés
  const handleApply = useCallback(() => {
    if (!result) return;

    const selected = result.actesDetectes.filter((_, index) => selectedActes.has(index));
    if (selected.length === 0) {
      showToast('Aucun acte sélectionné', 'warning');
      return;
    }

    const updates = ServerDocumentScanner.createActesFromValidated(selected, enquete);

    if (Object.keys(updates).length === 0) {
      showToast('Aucune modification à appliquer', 'info');
      return;
    }

    onApplyActes(updates);

    const nbEcoutes = (updates.ecoutes?.length || 0) - (enquete.ecoutes?.length || 0);
    const nbGeolocs = (updates.geolocalisations?.length || 0) - (enquete.geolocalisations?.length || 0);

    // Compter les prolongations (actes mis à jour vs créés)
    const nbProlongations = selected.filter(a => a.type.startsWith('prolongation_')).length;
    const nbNouvelles = selected.length - nbProlongations;

    const parts = [];
    if (nbEcoutes > 0) parts.push(`${nbEcoutes} écoute(s)`);
    if (nbGeolocs > 0) parts.push(`${nbGeolocs} géolocalisation(s)`);

    let detail = '';
    if (nbNouvelles > 0 && nbProlongations > 0) {
      detail = ` (${nbNouvelles} nouveau(x), ${nbProlongations} prolongation(s))`;
    }

    // Vérifier si des actes sélectionnés avaient des warnings
    const actesAvecWarnings = selected.filter(a => a.warnings.length > 0);
    if (actesAvecWarnings.length > 0) {
      showToast(
        `${parts.join(' et ')} créée(s)${detail}. ` +
        `${actesAvecWarnings.length} acte(s) avec avertissements — vérifiez les dates et durées.`,
        'warning'
      );
    } else {
      showToast(
        `${parts.join(' et ')} créée(s) / mise(s) à jour avec succès${detail}`,
        'success'
      );
    }
    onClose();
  }, [result, selectedActes, enquete, onApplyActes, onClose, showToast]);

  // Toggle sélection d'un acte
  const toggleSelection = (index: number) => {
    setSelectedActes(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (!result) return;
    if (selectedActes.size === result.actesDetectes.length) {
      setSelectedActes(new Set());
    } else {
      setSelectedActes(new Set(result.actesDetectes.map((_, i) => i)));
    }
  };

  const toggleDetails = (index: number) => {
    setExpandedDetails(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  // ─── Labels lisibles ───
  const typeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'autorisation_initiale_ecoute': 'Nouvelle écoute',
      'autorisation_initiale_geoloc': 'Nouvelle géolocalisation',
      'prolongation_ecoute': 'Prolongation écoute',
      'prolongation_geoloc': 'Prolongation géoloc',
      'requete_ecoute': 'Requête écoute',
      'requete_geoloc': 'Requête géoloc'
    };
    return labels[type] || type;
  };

  const autoriteLabel = (a: string) => a === 'jld' ? 'JLD' : 'Procureur';

  const confidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return <Badge className="bg-green-100 text-green-700 text-xs">Haute ({Math.round(confidence * 100)}%)</Badge>;
    if (confidence >= 0.5) return <Badge className="bg-yellow-100 text-yellow-700 text-xs">Moyenne ({Math.round(confidence * 100)}%)</Badge>;
    return <Badge className="bg-red-100 text-red-700 text-xs">Faible ({Math.round(confidence * 100)}%)</Badge>;
  };

  const typeIcon = (type: string) => {
    if (type.includes('ecoute')) return <Phone className="h-4 w-4 text-blue-500" />;
    if (type.includes('geoloc')) return <MapPin className="h-4 w-4 text-green-500" />;
    return <FileText className="h-4 w-4 text-gray-500" />;
  };

  const typeBadgeColor = (type: string) => {
    if (type.includes('prolongation')) return 'bg-orange-100 text-orange-700 border-orange-200';
    if (type.includes('initiale')) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (type.includes('requete')) return 'bg-purple-100 text-purple-700 border-purple-200';
    return 'bg-gray-100 text-gray-600';
  };

  // ─── Rendu ───

  return (
    <Dialog open={isOpen} onOpenChange={() => { if (phase !== 'scanning' && phase !== 'analyzing') onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Analyse automatique des documents
          </DialogTitle>
        </DialogHeader>

        {/* ── Phase idle ── */}
        {phase === 'idle' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 space-y-2">
                  <p className="font-medium">Cette fonctionnalité analyse les PDF du dossier serveur pour :</p>
                  <ul className="list-disc ml-4 space-y-1 text-xs">
                    <li>Détecter les autorisations initiales et prolongations (écoutes, géolocalisations)</li>
                    <li>Extraire les données clés : cibles, durées, dates, tribunal</li>
                    <li>Vérifier les doublons avec les actes existants</li>
                    <li>Proposer la création automatique des actes (après votre validation)</li>
                  </ul>
                  <p className="text-xs mt-2">
                    Tous les sous-dossiers seront scannés (y compris les dossiers en double comme "Geoloc" et "Géoloc").
                  </p>
                </div>
              </div>
            </div>

            {scanError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 whitespace-pre-line">{scanError}</p>
                </div>
              </div>
            )}

            {enquete.cheminExterne ? (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Chemin externe :</span>{' '}
                <span className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                  {enquete.cheminExterne}
                  {enquete.useSubfolderForExternal !== false && `/${enquete.numero}`}
                </span>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">
                  Configurez d&apos;abord un chemin externe dans la section Documents.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Phase scanning / analyzing ── */}
        {(phase === 'scanning' || phase === 'analyzing') && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm text-gray-600">{progress}</p>
            <p className="text-xs text-gray-400">Ne fermez pas cette fenêtre</p>
          </div>
        )}

        {/* ── Phase results ── */}
        {phase === 'results' && result && (
          <div className="space-y-4">
            {/* Statistiques */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{result.stats.totalPDFs}</p>
                <p className="text-xs text-blue-600">PDF scannés</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{result.stats.totalReconnus}</p>
                <p className="text-xs text-green-600">Actes détectés</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{result.stats.totalDoublons}</p>
                <p className="text-xs text-amber-600">Doublons ignorés</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-700">{result.stats.totalNonReconnus}</p>
                <p className="text-xs text-gray-600">Non reconnus</p>
              </div>
            </div>

            {/* Dossiers scannés */}
            <p className="text-xs text-gray-500">
              Dossiers scannés : {result.stats.foldersScanned.join(', ')}
            </p>

            {/* Actes détectés */}
            {result.actesDetectes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Actes détectés ({result.actesDetectes.length})
                  </h3>
                  <Button
                    variant="ghost" size="sm"
                    onClick={toggleAllSelection}
                    className="text-xs"
                  >
                    {selectedActes.size === result.actesDetectes.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </Button>
                </div>

                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {result.actesDetectes.map((acte, index) => (
                    <div
                      key={index}
                      className={`border rounded-lg p-3 transition-colors ${
                        selectedActes.has(index)
                          ? 'border-blue-300 bg-blue-50/50'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      {/* Ligne principale */}
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedActes.has(index)}
                          onChange={() => toggleSelection(index)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 flex-shrink-0"
                        />

                        {typeIcon(acte.type)}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`text-xs ${typeBadgeColor(acte.type)}`}>
                              {typeLabel(acte.type)}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {autoriteLabel(acte.autorite)}
                            </Badge>
                            {confidenceBadge(acte.confidence)}
                          </div>

                          <div className="mt-1 text-sm">
                            <span className="font-medium">
                              {acte.cibles.join(', ') || 'Cible non détectée'}
                            </span>
                            {acte.titulaire && (
                              <span className="text-gray-500 text-xs ml-2">
                                (tit. {acte.titulaire})
                              </span>
                            )}
                            {acte.utilisateur && (
                              <span className="text-gray-500 text-xs ml-2">
                                (util. {acte.utilisateur})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span>Durée : {acte.duree} {acte.dureeUnit}</span>
                            <span>Date : {acte.dateAutorisation}</span>
                            <span>Tribunal : {acte.tribunal}</span>
                          </div>
                        </div>

                        <Button
                          variant="ghost" size="sm"
                          onClick={() => toggleDetails(index)}
                          className="flex-shrink-0"
                        >
                          {expandedDetails.has(index) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>

                      {/* Détails expandés */}
                      {expandedDetails.has(index) && (
                        <div className="mt-3 ml-7 space-y-2 text-xs border-t pt-2">
                          <p><span className="font-medium">Fichier :</span> {acte.source.fileName}</p>
                          <p><span className="font-medium">Chemin :</span> <span className="text-muted-foreground break-all">{acte.source.filePath}</span></p>
                          <p><span className="font-medium">Dossier :</span> {acte.source.sourceFolder}</p>
                          {acte.numeroPV && <p><span className="font-medium">N° PV :</span> {acte.numeroPV}</p>}
                          {acte.objetDescription && <p><span className="font-medium">Objet :</span> {acte.objetDescription}</p>}
                          {acte.dateAutorisationInitiale && (
                            <p><span className="font-medium">Autorisation initiale :</span> {acte.dateAutorisationInitiale}</p>
                          )}

                          {acte.errors.length > 0 && (
                            <div className="bg-red-50 rounded p-2 mt-1">
                              <p className="font-medium text-red-700">Erreurs :</p>
                              {acte.errors.map((err, i) => (
                                <p key={i} className="text-red-600">{err}</p>
                              ))}
                            </div>
                          )}

                          {acte.warnings.length > 0 && (
                            <div className="bg-yellow-50 rounded p-2 mt-1">
                              <p className="font-medium text-yellow-700">Avertissements :</p>
                              {acte.warnings.map((warn, i) => (
                                <p key={i} className="text-yellow-600">{warn}</p>
                              ))}
                            </div>
                          )}

                          {/* Info chaînage pour prolongations */}
                          {acte.type.startsWith('prolongation_') && (
                            <div className="bg-blue-50 rounded p-2 mt-1">
                              <p className="font-medium text-blue-700">Chaînage :</p>
                              {(() => {
                                // Chercher l'acte initial correspondant
                                const cible = acte.cibles[0];
                                let acteInitialTrouve = false;

                                if (acte.type === 'prolongation_ecoute') {
                                  const normalized = cible?.replace(/\D/g, '');
                                  acteInitialTrouve = (enquete.ecoutes || []).some(e =>
                                    e.numero.replace(/\D/g, '') === normalized
                                  );
                                } else if (acte.type === 'prolongation_geoloc') {
                                  const plaqueMatch = cible?.match(/([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/);
                                  if (plaqueMatch) {
                                    const p = plaqueMatch[1].replace(/[- ]/g, '');
                                    acteInitialTrouve = (enquete.geolocalisations || []).some(g => {
                                      const gp = g.objet.match(/([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/);
                                      return gp && gp[1].replace(/[- ]/g, '') === p;
                                    });
                                  }
                                }

                                return acteInitialTrouve ? (
                                  <p className="text-blue-600 flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" /> Acte initial trouvé dans l&apos;enquête
                                  </p>
                                ) : (
                                  <p className="text-orange-600 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Acte initial non trouvé — sera créé automatiquement
                                    {acte.dateAutorisationInitiale && ` (date initiale : ${acte.dateAutorisationInitiale})`}
                                  </p>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aucun acte détecté */}
            {result.actesDetectes.length === 0 && (
              <div className="text-center py-6 text-gray-500">
                <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">Aucun nouvel acte détecté dans les documents.</p>
                {result.stats.totalDoublons > 0 && (
                  <p className="text-xs mt-1">
                    {result.stats.totalDoublons} doublon(s) ignoré(s) — les actes sont déjà dans l&apos;enquête.
                  </p>
                )}
              </div>
            )}

            {/* Doublons ignorés */}
            {result.doublonsIgnores.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900"
                  onClick={() => setShowDoublons(!showDoublons)}
                >
                  {showDoublons ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <AlertTriangle className="h-3 w-3" />
                  {result.doublonsIgnores.length} doublon(s) ignoré(s)
                </button>
                {showDoublons && (
                  <div className="ml-5 space-y-1 text-xs text-amber-700 bg-amber-50 rounded p-2">
                    {result.doublonsIgnores.map(({ acte, raison }, i) => (
                      <p key={i}>
                        <span className="font-medium">{acte.source.fileName}</span>
                        <ArrowRight className="h-3 w-3 inline mx-1" />
                        {raison}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Alertes documents manquants */}
            {result.alertes && result.alertes.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-orange-700 hover:text-orange-900 font-medium"
                  onClick={() => setShowAlertes(!showAlertes)}
                >
                  {showAlertes ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <AlertTriangle className="h-4 w-4" />
                  {result.alertes.length} document(s) manquant(s) dans la chaîne légale
                </button>
                {showAlertes && (
                  <div className="ml-5 space-y-1 text-xs bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-orange-800 font-medium mb-2">
                      Documents attendus non trouvés dans le dossier scanné :
                    </p>
                    {/* Grouper par acte */}
                    {(() => {
                      const groupes = new Map<string, AlerteDocumentManquant[]>();
                      for (const alerte of result.alertes) {
                        const key = `${alerte.acteType}_${alerte.acteIndex}`;
                        if (!groupes.has(key)) groupes.set(key, []);
                        groupes.get(key)!.push(alerte);
                      }
                      return Array.from(groupes.entries()).map(([key, alertes]) => (
                        <div key={key} className="mb-2 last:mb-0">
                          <p className="font-medium text-orange-900 flex items-center gap-1">
                            {alertes[0].acteType === 'ecoute'
                              ? <Phone className="h-3 w-3" />
                              : <MapPin className="h-3 w-3" />
                            }
                            {alertes[0].acteLabel}
                          </p>
                          <ul className="ml-5 mt-1 space-y-0.5">
                            {alertes.map((a, i) => (
                              <li key={i} className={`flex items-center gap-1 ${
                                a.severite === 'error' ? 'text-red-700' : 'text-orange-700'
                              }`}>
                                {a.severite === 'error'
                                  ? <XCircle className="h-3 w-3 flex-shrink-0" />
                                  : <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                }
                                {a.documentManquant}
                                {a.severite === 'error'
                                  ? <span className="text-red-500 text-[10px] ml-1">(obligatoire)</span>
                                  : <span className="text-orange-500 text-[10px] ml-1">(recommandé)</span>
                                }
                              </li>
                            ))}
                          </ul>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Non reconnus */}
            {result.nonReconnus.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
                  onClick={() => setShowNonReconnus(!showNonReconnus)}
                >
                  {showNonReconnus ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {result.nonReconnus.length} document(s) non reconnu(s)
                </button>
                {showNonReconnus && (
                  <div className="ml-5 space-y-1 text-xs text-gray-600 bg-gray-50 rounded p-2">
                    {result.nonReconnus.map((doc, i) => (
                      <p key={i}>{doc.sourceFolder}/{doc.fileName}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Erreurs */}
            {result.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                <p className="text-xs font-medium text-red-700 mb-1">Erreurs :</p>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600">{err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="flex gap-2">
          {phase === 'idle' && (
            <>
              <Button variant="outline" onClick={onClose}>Fermer</Button>
              <Button
                onClick={startAnalysis}
                disabled={!enquete.cheminExterne}
                className="flex items-center gap-2"
              >
                <Search className="h-4 w-4" />
                Lancer l&apos;analyse
              </Button>
            </>
          )}

          {phase === 'results' && (
            <>
              <Button variant="outline" onClick={onClose}>Fermer</Button>
              <Button
                variant="outline"
                onClick={() => { setPhase('idle'); setResult(null); }}
              >
                Relancer
              </Button>
              {result && (result.actesDetectes.length > 0 || result.doublonsIgnores.length > 0) && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowVerification(true)}
                    className="flex items-center gap-2"
                    title="Vérifier les doublons avec les actes existants et suggérer des corrections"
                  >
                    <Shield className="h-4 w-4" />
                    Vérifier doublons
                  </Button>
                  <Button
                    onClick={handleApply}
                    disabled={selectedActes.size === 0}
                    className="flex items-center gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Créer {selectedActes.size} acte(s)
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Modal de vérification des doublons */}
      {result && (
        <VerificationDoublonsModal
          isOpen={showVerification}
          onClose={() => setShowVerification(false)}
          enquete={enquete}
          parsedActes={result.actesDetectes}
          onApplyCorrections={(updates) => {
            onApplyActes(updates);
            showToast('Corrections appliquées aux actes existants', 'success');
          }}
          onContinueWithNew={(newActes) => {
            // Mettre à jour la sélection pour ne garder que les actes validés comme nouveaux
            const newSelectedSet = new Set<number>();
            result.actesDetectes.forEach((acte, index) => {
              if (newActes.includes(acte)) {
                newSelectedSet.add(index);
              }
            });
            setSelectedActes(newSelectedSet);
            setShowVerification(false);
            showToast(
              `${newSelectedSet.size} acte(s) validé(s) pour création. ${result.actesDetectes.length - newSelectedSet.size} doublon(s) retiré(s).`,
              'info'
            );
          }}
        />
      )}
    </Dialog>
  );
};
