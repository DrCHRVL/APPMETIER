'use client';

/**
 * Synthèse IA d'un dossier — LLM auto-hébergé (voir /api/ia).
 * Construit le markdown du dossier localement, l'envoie au serveur IA du
 * service, affiche le résultat. Rien ne part vers un service tiers.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Sparkles, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { buildDossierMarkdown, runSynthese, iaStatus, DEFAULT_IA_PROMPT, IA_PROMPT_KEY } from '@/lib/web/iaSynthese';
import { ElectronBridge } from '@/utils/electronBridge';
import { renderFormattedText } from '@/lib/formatCR';

interface SyntheseIAModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
}

export const SyntheseIAModal = ({ isOpen, onClose, enquete }: SyntheseIAModalProps) => {
  const [phase, setPhase] = useState<'check' | 'running' | 'done' | 'error' | 'disabled'>('check');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setPhase('check'); setText(''); setError('');
      const status = await iaStatus();
      if (cancelled) return;
      if (!status.enabled) { setPhase('disabled'); return; }
      setModel(status.model || '');
      setPhase('running');
      try {
        const prompt = String(await ElectronBridge.getData(IA_PROMPT_KEY, DEFAULT_IA_PROMPT) || DEFAULT_IA_PROMPT);
        const content = buildDossierMarkdown(enquete);
        const result = await runSynthese(prompt, content);
        if (!cancelled) { setText(result); setPhase('done'); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Erreur'); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, enquete]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            Synthèse automatique — dossier {enquete.numero}
            {model && <span className="text-xs font-normal text-gray-400">({model}, serveur du service)</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {phase === 'check' && <p className="text-sm text-gray-500 p-4">Vérification du serveur IA…</p>}
          {phase === 'disabled' && (
            <div className="p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
              La synthèse IA n&apos;est pas configurée sur ce serveur. L&apos;administrateur peut l&apos;activer en
              installant Ollama sur le serveur SIRAL et en définissant <code>SIRAL_IA_URL</code> —
              voir Paramètres → Synthèse IA.
            </div>
          )}
          {phase === 'running' && (
            <div className="p-6 flex items-center gap-3 text-sm text-gray-600">
              <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
              Analyse du dossier en cours (CR, mis en cause, actes)… Sur un petit serveur, comptez une à trois minutes.
            </div>
          )}
          {phase === 'error' && (
            <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}
          {phase === 'done' && (
            <div className="prose prose-sm max-w-none p-1 text-[13px] leading-relaxed whitespace-pre-wrap">
              {renderFormattedText(text)}
            </div>
          )}
        </div>

        {phase === 'done' && (
          <p className="text-[11px] text-gray-400">
            Généré par une IA locale : à relire systématiquement — les sources citées (CR, documents) font foi.
          </p>
        )}

        <DialogFooter>
          {phase === 'done' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
