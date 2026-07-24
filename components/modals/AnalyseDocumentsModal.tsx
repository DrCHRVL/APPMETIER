import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Search, Loader, CheckCircle, XCircle, AlertTriangle, Phone, MapPin,
  FileText, ChevronDown, ChevronUp, Eye, EyeOff, ArrowRight, Info, Shield,
  Sparkles, Cpu
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
  /** Analyse immédiate de documents déjà extraits (texte des PDF tout juste
   *  téléversés) — court-circuite le scan du dossier externe. */
  precomputedDocs?: ScannedDocument[];
  /** Classe le CR de réception suggéré par l'IA au dossier (analyse IA seulement). */
  onAddCR?: (contenu: string) => void;
}

type Phase = 'idle' | 'scanning' | 'analyzing' | 'results';

export const AnalyseDocumentsModal = ({
  isOpen,
  onClose,
  enquete,
  onApplyActes,
  precomputedDocs,
  onAddCR
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
  // Moteur d'analyse : IA (Claude de l'attaché, admin uniquement) ou classique
  // (heuristiques regex). L'IA est le défaut dès qu'elle est disponible.
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<'ia' | 'regex'>('ia');
  const aiAvailableRef = useRef(false);
  const engineRef = useRef<'ia' | 'regex'>('ia');
  useEffect(() => { engineRef.current = engine; }, [engine]);

  const { showToast } = useToast();

  // Reset on open : sonde la disponibilité de l'IA, puis lance l'analyse
  // immédiate si des documents ont été pré-extraits (téléversement).
  useEffect(() => {
    if (!isOpen) return;
    setPhase('idle');
    setResult(null);
    setSelectedActes(new Set());
    setExpandedDetails(new Set());
    setScanError(null);
    let cancelled = false;
    (async () => {
      const ok = await ServerDocumentScanner.isAIAvailable();
      if (cancelled) return;
      aiAvailableRef.current = ok;
      setAiAvailable(ok);
      if (precomputedDocs && precomputedDocs.length > 0) startAnalysis();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Choisit le moteur et exécute l'analyse. IA par défaut (repli automatique
   * sur le moteur classique en cas d'indisponibilité ou d'erreur du service).
   */
  const analyzeDocs = useCallback(async (docs: ScannedDocument[]): Promise<AnalysisResult> => {
    const useAI = engineRef.current === 'ia' && aiAvailableRef.current;
    if (useAI) {
      setProgress(`Analyse IA de ${docs.length} document(s) — lecture des actes et de la chaîne légale…`);
      try {
        return await ServerDocumentScanner.analyzeExternalDocumentsAI(enquete, docs);
      } catch (error) {
        console.warn('Analyse IA indisponible, repli sur le moteur classique:', error);
        showToast('Analyse IA indisponible — repli sur l\'analyse classique', 'warning');
        setProgress(`Analyse classique de ${docs.length} document(s)…`);
      }
    }
    return ServerDocumentScanner.analyzeExternalDocuments(enquete, docs);
  }, [enquete, showToast]);

  // Lancer l'analyse — version web : uniquement sur les pièces déjà
  // téléversées (leur texte est converti dans le navigateur au passage et
  // fourni via `precomputedDocs` par la bannière « Analyser (IA) » de la
  // section Documents). L'ancien scan d'un dossier réseau (Electron) a été
  // retiré avec l'édition bureau.
  const startAnalysis = useCallback(async () => {
    if (!precomputedDocs || precomputedDocs.length === 0) {
      setScanError(
        'Aucune pièce à analyser ici : téléversez les PDF dans une zone de la section '
        + 'Documents de l\'enquête, puis cliquez « Analyser (IA) » dans la bannière qui apparaît.'
      );
      return;
    }
    // analyse directe des PDF qui viennent d'être téléversés
    setPhase('analyzing');
    setProgress(`Analyse de ${precomputedDocs.length} PDF en cours...`);
    setScanError(null);
    try {
      const analysisResult = await analyzeDocs(precomputedDocs);
      const preSelected = new Set<number>();
      analysisResult.actesDetectes.forEach((acte, index) => {
        if (acte.confidence >= 0.6 && acte.errors.length === 0 && !acte.correctionPossible) preSelected.add(index);
      });
      setSelectedActes(preSelected);
      setResult(analysisResult);
      setPhase('results');
    } catch (error) {
      setScanError(`Erreur d'analyse : ${error instanceof Error ? error.message : 'inconnue'}`);
      setPhase('idle');
    }
  }, [precomputedDocs, analyzeDocs]);

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
    // Seuls les vrais nouveaux actes (non correction) sont concernés
    const nouveauxIndices = result.actesDetectes
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.correctionPossible)
      .map(({ i }) => i);
    const allSelected = nouveauxIndices.every(i => selectedActes.has(i));
    if (allSelected) {
      setSelectedActes(new Set());
    } else {
      setSelectedActes(new Set(nouveauxIndices));
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

  // ─── Dérivés ───
  // Après vérification, les corrections validées comme "nouveaux" passent dans selectedActes
  // → elles quittent alors la section corrections pour rejoindre les nouveaux
  const nouveauxActes = result
    ? result.actesDetectes
        .map((acte, idx) => ({ acte, idx }))
        .filter(({ acte, idx }) => !acte.correctionPossible || selectedActes.has(idx))
    : [];
  const correctionActes = result
    ? result.actesDetectes
        .map((acte, idx) => ({ acte, idx }))
        .filter(({ acte, idx }) => acte.correctionPossible && !selectedActes.has(idx))
    : [];

  // ─── Rendu ───

  return (
    <Dialog open={isOpen} onOpenChange={() => { if (phase !== 'scanning' && phase !== 'analyzing') onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Analyse automatique des documents
            {aiAvailable && engine === 'ia' && (
              <Badge className="ml-1 bg-violet-100 text-violet-700 border border-violet-200 gap-1 text-xs">
                <Sparkles className="h-3 w-3" /> IA
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── Sélecteur de moteur (admin, attaché actif) ── */}
        {aiAvailable && phase === 'idle' && (
          <div className="flex items-center justify-between rounded-lg border border-violet-200/70 bg-violet-50/50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-violet-800">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span className="font-medium">Analyse assistée par l&apos;IA</span>
              <span className="text-violet-500/80 hidden sm:inline">— lecture fine des actes et de la chaîne légale, réservée à l&apos;administrateur</span>
            </div>
            <div className="flex items-center gap-1 rounded-md bg-white border border-violet-200 p-0.5">
              <button
                type="button"
                onClick={() => setEngine('ia')}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  engine === 'ia' ? 'bg-violet-600 text-white' : 'text-violet-700 hover:bg-violet-50'
                }`}
              >
                <Sparkles className="h-3 w-3" /> IA
              </button>
              <button
                type="button"
                onClick={() => setEngine('regex')}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  engine === 'regex' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
                title="Analyse par règles (heuristiques), sans IA"
              >
                <Cpu className="h-3 w-3" /> Classique
              </button>
            </div>
          </div>
        )}

        {/* ── Phase idle ── */}
        {phase === 'idle' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 space-y-2">
                  <p className="font-medium">Cette fonctionnalité analyse les PDF téléversés pour :</p>
                  <ul className="list-disc ml-4 space-y-1 text-xs">
                    <li>Détecter les autorisations initiales et prolongations (écoutes, géolocalisations)</li>
                    <li>Extraire les données clés : cibles, durées, dates, tribunal</li>
                    <li>Vérifier les doublons avec les actes existants</li>
                    <li>Signaler les incohérences (numéro de procédure divergent, NATINF absents) et suggérer un CR de réception</li>
                    <li>Proposer la création automatique des actes (après votre validation)</li>
                    {aiAvailable && engine === 'ia' && (
                      <li className="text-violet-700">
                        <strong>Mode IA</strong> : lecture fine des ordonnances (formats atypiques, OCR bruité) et
                        évaluation de la chaîne légale par le modèle Claude de l&apos;attaché.
                      </li>
                    )}
                  </ul>
                  <p className="text-xs mt-2">
                    {precomputedDocs && precomputedDocs.length > 0
                      ? `${precomputedDocs.length} pièce(s) prête(s) à analyser (converties au téléversement).`
                      : 'Téléversez d\'abord les PDF dans une zone de la section Documents — la bannière « Analyser (IA) » lance alors l\'analyse.'}
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
                <p className="text-2xl font-bold text-green-700">{nouveauxActes.length}</p>
                <p className="text-xs text-green-600">Nouveaux actes</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{result.stats.totalDoublons}</p>
                <p className="text-xs text-amber-600">Doublons ignorés</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-orange-700">{correctionActes.length}</p>
                <p className="text-xs text-orange-600">Corrections possibles</p>
              </div>
            </div>

            {/* Dossiers scannés + moteur utilisé */}
            <div className="flex items-center justify-between flex-wrap gap-1">
              <p className="text-xs text-gray-500">
                Dossiers scannés : {result.stats.foldersScanned.join(', ')}
              </p>
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                result.analyzedBy === 'ia' ? 'text-violet-600' : 'text-gray-400'
              }`}>
                {result.analyzedBy === 'ia'
                  ? <><Sparkles className="h-3 w-3" /> Analysé par l&apos;IA</>
                  : <><Cpu className="h-3 w-3" /> Analyse classique</>}
              </span>
            </div>

            {/* Synthèse de l'IA */}
            {result.analyzedBy === 'ia' && result.iaResume && (
              <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <Sparkles className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-violet-900 leading-relaxed">{result.iaResume}</p>
              </div>
            )}

            {/* Incohérences document ↔ enquête (analyse IA) */}
            {result.analyzedBy === 'ia' && (result.iaIncoherences?.length || 0) > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Incohérences relevées entre les documents et l&apos;enquête
                </p>
                <ul className="ml-5 space-y-1">
                  {result.iaIncoherences!.map((inc, i) => (
                    <li key={i} className={`text-xs flex items-start gap-1.5 ${inc.severite === 'error' ? 'text-red-700' : 'text-orange-700'}`}>
                      {inc.severite === 'error'
                        ? <XCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        : <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                      <span>
                        <span className="font-medium">
                          {inc.type === 'numero_procedure' ? 'Numéro de procédure' : inc.type === 'natinf_absent' ? 'NATINF absent de l\'enquête' : 'Dates'}
                          {inc.fileName ? ` — ${inc.fileName}` : ''} :
                        </span>{' '}
                        {inc.detail}
                        {inc.type === 'numero_procedure' && (
                          <span className="block text-[10.5px] text-red-500 mt-0.5">
                            Vérifiez que ce document a été téléversé dans le bon dossier avant de créer les actes.
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* CR de réception suggéré (analyse IA) */}
            {result.analyzedBy === 'ia' && result.iaCrSuggere && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                  <FileText className="h-3.5 w-3.5" />
                  CR de réception suggéré (prise de notes)
                </p>
                <pre className="whitespace-pre-wrap rounded border border-blue-100 bg-white p-2 font-sans text-xs leading-relaxed text-gray-700">{result.iaCrSuggere}</pre>
                {onAddCR && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
                    onClick={() => {
                      onAddCR(result.iaCrSuggere!);
                      showToast('CR classé au dossier', 'success');
                      setResult({ ...result, iaCrSuggere: undefined });
                    }}
                  >
                    <CheckCircle className="h-3 w-3" />
                    Classer ce CR au dossier
                  </Button>
                )}
              </div>
            )}

            {/* ─── 1. Nouveaux actes détectés ─── */}
            {nouveauxActes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-2 text-green-700">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Nouveaux actes détectés ({nouveauxActes.length})
                  </h3>
                  <Button
                    variant="ghost" size="sm"
                    onClick={toggleAllSelection}
                    className="text-xs"
                  >
                    {nouveauxActes.every(({ idx }) => selectedActes.has(idx)) ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </Button>
                </div>

                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {nouveauxActes.map(({ acte, idx: index }) => (
                    <div
                      key={index}
                      className={`border rounded-lg p-3 transition-colors ${
                        selectedActes.has(index)
                          ? 'border-blue-300 bg-blue-50/50'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
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
                              <span className="text-gray-500 text-xs ml-2">(tit. {acte.titulaire})</span>
                            )}
                            {acte.utilisateur && (
                              <span className="text-gray-500 text-xs ml-2">(util. {acte.utilisateur})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span>Durée : {acte.duree} {acte.dureeUnit}</span>
                            <span>Date : {acte.dateAutorisation}</span>
                            <span>Tribunal : {acte.tribunal}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => toggleDetails(index)} className="flex-shrink-0">
                          {expandedDetails.has(index) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>

                      {expandedDetails.has(index) && (
                        <div className="mt-3 ml-7 space-y-2 text-xs border-t pt-2">
                          {acte.motif && (
                            <div className="flex items-start gap-1.5 rounded bg-violet-50 border border-violet-100 p-2">
                              <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 flex-shrink-0" />
                              <p className="text-violet-800"><span className="font-medium">Analyse IA :</span> {acte.motif}</p>
                            </div>
                          )}
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
                              {acte.errors.map((err, i) => <p key={i} className="text-red-600">{err}</p>)}
                            </div>
                          )}
                          {acte.warnings.length > 0 && (
                            <div className="bg-yellow-50 rounded p-2 mt-1">
                              <p className="font-medium text-yellow-700">Avertissements :</p>
                              {acte.warnings.map((warn, i) => <p key={i} className="text-yellow-600">{warn}</p>)}
                            </div>
                          )}
                          {acte.type.startsWith('prolongation_') && (
                            <div className="bg-blue-50 rounded p-2 mt-1">
                              <p className="font-medium text-blue-700">Chaînage :</p>
                              {(() => {
                                const cible = acte.cibles[0];
                                let acteInitialTrouve = false;
                                if (acte.type === 'prolongation_ecoute') {
                                  const normalized = cible?.replace(/\D/g, '');
                                  acteInitialTrouve = (enquete.ecoutes || []).some(e => e.numero.replace(/\D/g, '') === normalized);
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

            {/* Aucun acte du tout */}
            {nouveauxActes.length === 0 && correctionActes.length === 0 && (
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

            {/* ─── 2. Corrections possibles ─── */}
            {correctionActes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    Corrections possibles ({correctionActes.length})
                  </h3>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setShowVerification(true)}
                    className="text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    <Shield className="h-3 w-3" />
                    Vérifier et corriger
                  </Button>
                </div>
                <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
                  Ces documents correspondent à des actes existants avec des divergences. Ils ne peuvent pas être créés comme nouveaux actes — utilisez <strong>Vérifier et corriger</strong> pour examiner et appliquer les corrections.
                </p>
                <div className="space-y-2 max-h-[35vh] overflow-y-auto">
                  {correctionActes.map(({ acte, idx: index }) => (
                    <div
                      key={index}
                      className="border border-orange-300 bg-orange-50/40 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                        {typeIcon(acte.type)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`text-xs ${typeBadgeColor(acte.type)}`}>
                              {typeLabel(acte.type)}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {autoriteLabel(acte.autorite)}
                            </Badge>
                            <Badge className="text-xs bg-orange-100 text-orange-700 border border-orange-300">
                              Correction suggérée
                            </Badge>
                            {confidenceBadge(acte.confidence)}
                          </div>
                          <div className="mt-1 text-sm">
                            <span className="font-medium">
                              {acte.cibles.join(', ') || 'Cible non détectée'}
                            </span>
                            {acte.titulaire && (
                              <span className="text-gray-500 text-xs ml-2">(tit. {acte.titulaire})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span>Durée : {acte.duree} {acte.dureeUnit}</span>
                            <span>Date : {acte.dateAutorisation}</span>
                            <span>Tribunal : {acte.tribunal}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => toggleDetails(index)} className="flex-shrink-0">
                          {expandedDetails.has(index) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>

                      {expandedDetails.has(index) && (
                        <div className="mt-3 ml-7 space-y-2 text-xs border-t border-orange-200 pt-2">
                          {acte.motif && (
                            <div className="flex items-start gap-1.5 rounded bg-violet-50 border border-violet-100 p-2">
                              <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 flex-shrink-0" />
                              <p className="text-violet-800"><span className="font-medium">Analyse IA :</span> {acte.motif}</p>
                            </div>
                          )}
                          <p><span className="font-medium">Fichier :</span> {acte.source.fileName}</p>
                          <p><span className="font-medium">Chemin :</span> <span className="text-muted-foreground break-all">{acte.source.filePath}</span></p>
                          {acte.numeroPV && <p><span className="font-medium">N° PV :</span> {acte.numeroPV}</p>}
                          {acte.objetDescription && <p><span className="font-medium">Objet :</span> {acte.objetDescription}</p>}
                          {acte.warnings.length > 0 && (
                            <div className="bg-yellow-50 rounded p-2 mt-1">
                              <p className="font-medium text-yellow-700">Avertissements :</p>
                              {acte.warnings.map((warn, i) => <p key={i} className="text-yellow-600">{warn}</p>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── 3. Doublons ignorés ─── */}
            {result.doublonsIgnores.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 font-medium"
                  onClick={() => setShowDoublons(!showDoublons)}
                >
                  {showDoublons ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <AlertTriangle className="h-3 w-3" />
                  {result.doublonsIgnores.length} doublon(s) ignoré(s) — déjà dans l&apos;enquête
                </button>
                {showDoublons && (
                  <div className="ml-5 space-y-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
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

            {/* ─── 4. Documents manquants dans la chaîne légale ─── */}
            {result.alertes && result.alertes.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-orange-700 hover:text-orange-900 font-medium"
                  onClick={() => setShowAlertes(!showAlertes)}
                >
                  {showAlertes ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <AlertTriangle className="h-4 w-4" />
                  {result.alertes.length} document(s) manquant(s) dans la chaîne légale
                  {result.analyzedBy === 'ia' && (
                    <Badge className="ml-1 bg-violet-100 text-violet-700 border border-violet-200 gap-1 text-[10px] px-1.5 py-0">
                      <Sparkles className="h-2.5 w-2.5" /> IA
                    </Badge>
                  )}
                </button>
                {showAlertes && (
                  <div className="ml-5 space-y-1 text-xs bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-orange-800 font-medium mb-2">
                      Documents attendus non trouvés dans le dossier scanné :
                    </p>
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

            {/* ─── 5. Documents non reconnus ─── */}
            {result.nonReconnus.length > 0 && (
              <div className="space-y-1">
                <button
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
                  onClick={() => setShowNonReconnus(!showNonReconnus)}
                >
                  {showNonReconnus ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <FileText className="h-3 w-3" />
                  {result.nonReconnus.length} document(s) non reconnu(s)
                </button>
                {showNonReconnus && (
                  <div className="ml-5 space-y-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
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
                disabled={!precomputedDocs || precomputedDocs.length === 0}
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
                  {/* Bouton "Vérifier" visible si des corrections ou des doublons existent */}
                  {(correctionActes.length > 0 || result.doublonsIgnores.length > 0) && (
                    <Button
                      variant="outline"
                      onClick={() => setShowVerification(true)}
                      className={`flex items-center gap-2 ${
                        correctionActes.length > 0
                          ? 'border-orange-400 text-orange-700 hover:bg-orange-50'
                          : ''
                      }`}
                      title="Vérifier les doublons avec les actes existants et suggérer des corrections"
                    >
                      <Shield className="h-4 w-4" />
                      Vérifier doublons
                      {correctionActes.length > 0 && (
                        <Badge className="ml-1 bg-orange-500 text-white text-[10px] px-1">
                          {correctionActes.length}
                        </Badge>
                      )}
                    </Button>
                  )}
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
