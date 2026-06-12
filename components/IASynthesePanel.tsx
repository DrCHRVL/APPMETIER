'use client';

/**
 * Paramètres → Synthèse IA : état du serveur IA local et personnalisation du
 * prompt de synthèse (stocké dans les données chiffrées, par service).
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ElectronBridge } from '@/utils/electronBridge';
import { DEFAULT_IA_PROMPT, IA_PROMPT_KEY, iaStatus } from '@/lib/web/iaSynthese';
import { useToast } from '@/contexts/ToastContext';

export const IASynthesePanel = () => {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<{ enabled: boolean, model?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    (async () => {
      const p = await ElectronBridge.getData(IA_PROMPT_KEY, DEFAULT_IA_PROMPT);
      setPrompt(String(p || DEFAULT_IA_PROMPT));
      setStatus(await iaStatus());
    })();
  }, []);

  const save = async () => {
    await ElectronBridge.setData(IA_PROMPT_KEY, prompt);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    showToast('Prompt de synthèse enregistré', 'success');
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" /> Synthèse IA
        </h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          La synthèse utilise une IA <b>auto-hébergée sur le serveur du service</b> (Ollama) :
          aucune donnée n&apos;est envoyée à un service tiers. Le bouton « Synthèse IA » se trouve
          dans la section Comptes rendus de chaque dossier.
        </p>
      </div>

      <div className={`rounded-lg border p-3 text-sm ${status?.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        {status === null ? 'Vérification du serveur IA…'
          : status.enabled
            ? <>Serveur IA actif — modèle <b>{status.model}</b>.</>
            : <>Serveur IA non configuré. Sur le VPS : <code>docker run -d --name ollama -v ollama:/root/.ollama -p 127.0.0.1:11434:11434 ollama/ollama</code>,
              puis <code>docker exec ollama ollama pull qwen2.5:7b-instruct</code>, et définir <code>SIRAL_IA_URL=http://ollama:11434</code> dans le <code>.env</code>.
              (Prévoir ~8 Go de RAM ; sinon prendre la gamme VPS au-dessus.)</>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Prompt de synthèse (instructions données à l&apos;IA)</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={14}
          className="w-full text-[13px] leading-relaxed border rounded-lg p-3 font-mono focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={save}>
            <Save className="h-3.5 w-3.5" />{saved ? 'Enregistré ✓' : 'Enregistrer'}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setPrompt(DEFAULT_IA_PROMPT)}>
            <RotateCcw className="h-3.5 w-3.5" />Réinitialiser
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Compromis de confidentialité, assumé et désactivé par défaut : pour être analysé, le texte du dossier
        (déchiffré dans votre navigateur) transite vers le serveur IA du service, en HTTPS, traité en mémoire
        sans être stocké ni journalisé. Toute synthèse générée est à relire : l&apos;IA peut se tromper.
      </p>
    </div>
  );
};
