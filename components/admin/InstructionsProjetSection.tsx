'use client';

/**
 * SIRAL — Instructions du projet Claude web (Paramètres → Attaché IA).
 *
 * La version de RÉFÉRENCE des instructions permanentes du projet claude.ai
 * dans lequel le magistrat rédige ses actes — tenue dans SIRAL, chiffrée,
 * versionnée. Le magistrat l'édite ici et la COPIE dans son projet ; l'attaché
 * en propose des révisions (✓/✗, bloc « Propositions de méthode ») tirées des
 * actes corrigés à la main ou refusés ; Claude web la lit aussi par le
 * connecteur (`instructions_projet_lire`), ce qui rend la copie moins urgente.
 *
 * Composant de présentation : le panneau détient le texte (il lui sert aussi
 * de référence pour le diff des propositions) — chiffrement/déchiffrement dans
 * le navigateur, comme la mémoire.
 */
import { useState } from 'react';
import { Globe, Save, Copy, Loader2, CheckCircle2 } from 'lucide-react';

export function InstructionsProjetSection({ texte, charge, onChange, onSave, saving, existe }: {
  /** Texte courant (déchiffré ici), ou null tant qu'il n'est pas chargé. */
  texte: string | null;
  /** Recharge depuis le serveur. */
  charge: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  /** Le document a déjà été écrit (sinon : squelette par défaut). */
  existe: boolean;
}) {
  const [copie, setCopie] = useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte || '');
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch { /* presse-papiers indisponible : sélection manuelle dans la zone */ }
  };

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Globe className="h-4 w-4 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Instructions du projet Claude web</span>
        <span className="hidden text-[11px] text-gray-400 sm:inline">la version de référence — à coller dans les instructions de votre projet claude.ai</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copier}
            disabled={!texte}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Copie le texte entier — collez-le dans Paramètres du projet → Instructions, côté claude.ai"
          >
            {copie ? <CheckCircle2 className="h-3 w-3 text-[#2B5746]" /> : <Copy className="h-3 w-3" />}{copie ? 'Copié' : 'Copier'}
          </button>
          <button
            onClick={onSave}
            disabled={saving || texte == null}
            className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Enregistrer
          </button>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <p className="text-[11px] leading-relaxed text-gray-500">
          Vous rédigez vos actes dans un projet Claude web : c&apos;est <b>là</b> que les leçons de rédaction doivent atterrir.
          Ce texte en est la version de référence. L&apos;attaché en <b>propose des révisions</b> (bloc « Propositions de méthode »)
          quand vos corrections à la main ou vos refus d&apos;actes révèlent une règle générale ; vous appliquez d&apos;un ✓ puis
          <b> Copier</b> → coller dans les instructions du projet. Claude web le lit aussi par le connecteur
          (<code className="rounded bg-gray-100 px-1">instructions_projet_lire</code>), même avant que vous ne l&apos;ayez collé.
          {!existe && <> <span className="text-amber-700">Squelette par défaut : pas encore enregistré.</span></>}
        </p>
        {texte == null ? (
          <button onClick={charge} className="text-[11px] font-semibold text-[#2B5746] hover:underline">Charger le texte</button>
        ) : (
          <textarea
            value={texte}
            onChange={(e) => onChange(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-gray-200 p-2.5 font-mono text-[11.5px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40"
          />
        )}
      </div>
    </div>
  );
}
