'use client';

/**
 * SIRAL — Atelier des analyses profondes (plein écran).
 *
 * La bande de la page Assistant de justice dit l'essentiel ; ICI on voit
 * TOUT, sans empiler les accordéons : à gauche la liste filtrable des
 * chantiers, à droite le détail complet de celui qu'on regarde —
 * avancement chiffré, devis, pochette par pochette, journal des pas, et les
 * productions (fiches, synthèse, rapport) lisibles sur place.
 *
 * Le moteur tourne côté service attaché : fermer l'atelier n'interrompt rien.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers, Plus, Loader2, Play, Pause as PauseIcon, Trash2, Moon, BatteryLow,
  CheckCircle2, FileText, X, AlertTriangle, Search, ClipboardList, Sparkles, Zap,
} from 'lucide-react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { ProductionsSection } from './ProductionsSection';
import {
  useChantiers, etatBadge, uniteChantier, titreChantier, pourcentage, echecsChantier,
  fmtJetons, dureeDepuis, libelleEnCours, pasEnVol, TYPE_LABEL,
  type Chantier, type TypeChantier, type ActionChantier, type FeuChantiers,
} from './useChantiers';

type Filtre = 'tous' | 'actifs' | 'devis' | 'termines';

const FILTRES: Array<{ id: Filtre; label: string; test: (c: Chantier) => boolean }> = [
  { id: 'tous', label: 'Tous', test: () => true },
  { id: 'actifs', label: 'En cours', test: (c) => ['en_cours', 'synthese', 'pause'].includes(c.etat) },
  { id: 'devis', label: 'Devis', test: (c) => c.etat === 'devis' },
  { id: 'termines', label: 'Terminés', test: (c) => c.etat === 'termine' },
];

function IconeEtat({ icone }: { icone?: 'nuit' | 'forfait' | 'fini' }) {
  if (icone === 'nuit') return <Moon className="h-3 w-3" />;
  if (icone === 'forfait') return <BatteryLow className="h-3 w-3" />;
  if (icone === 'fini') return <CheckCircle2 className="h-3 w-3" />;
  return null;
}

function Jauge({ pct, termine, taille = 'fin' }: { pct: number; termine?: boolean; taille?: 'fin' | 'epais' }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-gray-100 ${taille === 'epais' ? 'h-2.5' : 'h-1.5'}`}>
      <div
        className={`h-full rounded-full transition-all ${termine ? 'bg-emerald-500' : 'bg-[#2B5746]'}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function Kpi({ valeur, libelle, accent }: { valeur: string | number; libelle: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      <p className={`text-[17px] font-bold leading-tight tabular-nums ${accent || 'text-gray-800'}`}>{valeur}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{libelle}</p>
    </div>
  );
}

export function ChantiersAtelier({
  onClose, selection, onSelection, ouvrirFormulaire = false,
}: {
  onClose: () => void;
  selection: string | null;
  onSelection: (id: string | null) => void;
  ouvrirFormulaire?: boolean;
}) {
  const { chantiers, feu, busy, creating, creer, action, now } = useChantiers();
  const enquetes = useEnquetesStore((s) => s.enquetes);

  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [recherche, setRecherche] = useState('');
  const [showForm, setShowForm] = useState(ouvrirFormulaire);
  const [typeChantier, setTypeChantier] = useState<TypeChantier>('dossier');
  const [numero, setNumero] = useState('');
  const [numeros, setNumeros] = useState<string[]>([]);
  const [consigne, setConsigne] = useState('');
  const [nuitSeulement, setNuitSeulement] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const listeFiltree = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const test = (FILTRES.find((f) => f.id === filtre) || FILTRES[0]).test;
    return chantiers.filter((c) => test(c) && (!q || titreChantier(c).toLowerCase().includes(q) || (c.consigne || '').toLowerCase().includes(q)));
  }, [chantiers, filtre, recherche]);

  // Le chantier regardé : celui qu'on a choisi, sinon le premier de la liste —
  // l'atelier ne s'ouvre jamais sur un panneau vide quand il y a de la matière.
  const courant = useMemo(
    () => chantiers.find((c) => c.id === selection) || listeFiltree[0] || null,
    [chantiers, selection, listeFiltree],
  );

  const ajouterNumero = useCallback(() => {
    const n = numero.trim();
    if (!n) return;
    setNumeros((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setNumero('');
  }, [numero]);

  const lancerCreation = useCallback(async () => {
    const id = await creer({ type: typeChantier, numero, numeros, consigne, nuitSeulement });
    if (id) {
      setShowForm(false); setNumero(''); setNumeros([]); setConsigne('');
      onSelection(id);
    }
  }, [creer, typeChantier, numero, numeros, consigne, nuitSeulement, onSelection]);

  const compte = (f: Filtre) => chantiers.filter((FILTRES.find((x) => x.id === f) || FILTRES[0]).test).length;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-50">
      {/* Barre de titre */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
          <Layers className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold text-gray-900">Analyses profondes</h2>
          <p className="truncate text-[11px] text-gray-500">
            Dépouillement massif, croisement de dossiers, alimentation de la cartographie.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#234737]"
        >
          <Plus className="h-3.5 w-3.5" />Nouvelle analyse
        </button>
        <button onClick={onClose} className="flex-shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50" title="Fermer (Échap)">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Colonne de gauche : la liste */}
        <aside className="flex w-[300px] flex-shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="space-y-2 border-b border-gray-100 p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher un dossier, un angle…"
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2 text-xs focus:border-[#2B5746] focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTRES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFiltre(f.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
                    filtre === f.id ? 'border-[#2B5746] bg-[#2B5746] text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-[#2B5746]/40'
                  }`}
                >
                  {f.label} <span className={filtre === f.id ? 'text-white/70' : 'text-gray-400'}>{compte(f.id)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {listeFiltree.length === 0 && (
              <p className="px-2 py-6 text-center text-[11px] text-gray-400">
                Aucun chantier ici. « Nouvelle analyse » pour en lancer un.
              </p>
            )}
            {listeFiltree.map((ch) => {
              const badge = etatBadge(ch);
              const pct = pourcentage(ch);
              const actif = courant?.id === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => onSelection(ch.id)}
                  className={`mb-1 block w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    actif ? 'border-[#2B5746] bg-emerald-50/40' : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded border px-1 py-0.5 text-[9.5px] font-semibold ${badge.cls}`}>
                      <IconeEtat icone={badge.icone} />{badge.label}
                    </span>
                    {ch.type !== 'dossier' && (
                      <span className="flex-shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
                        {ch.type === 'liens' ? 'Liens' : 'Carto'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11.5px] font-semibold text-gray-800" title={titreChantier(ch)}>{titreChantier(ch)}</p>
                  <p className="mt-0.5 text-[10px] tabular-nums text-gray-400">
                    {ch.etat === 'devis'
                      ? `${ch.totalPieces} ${uniteChantier(ch)} · ${ch.totalLots} lots`
                      : `${pct} % · ${ch.piecesFaites}/${ch.totalPieces} ${uniteChantier(ch)}`}
                  </p>
                  {ch.etat !== 'devis' && <div className="mt-1"><Jauge pct={pct} termine={ch.etat === 'termine'} /></div>}
                  {libelleEnCours(ch) && (
                    <p className="mt-1 flex items-center gap-1 text-[9.5px] text-blue-700">
                      <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-500" />
                      <span className="min-w-0 truncate">{libelleEnCours(ch)}</span>
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Colonne de droite : le détail, ou le formulaire */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {showForm && (
            <FormulaireChantier
              typeChantier={typeChantier} setTypeChantier={setTypeChantier}
              numero={numero} setNumero={setNumero}
              numeros={numeros} setNumeros={setNumeros} ajouterNumero={ajouterNumero}
              consigne={consigne} setConsigne={setConsigne}
              nuitSeulement={nuitSeulement} setNuitSeulement={setNuitSeulement}
              creating={creating} onCreer={lancerCreation} onFermer={() => setShowForm(false)}
              enquetes={enquetes.map((e) => String(e.numero))}
            />
          )}

          {!courant && !showForm && (
            <div className="grid h-full place-items-center">
              <div className="max-w-md text-center">
                <Layers className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-700">Aucun chantier pour l&apos;instant</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  « Dossier en détail » dépouille un dossier entier en fiches factuelles (la nuit, par lots,
                  interruptible) puis en tire une synthèse ; « liens entre dossiers » croise les fiches de plusieurs
                  dossiers en un rapport de recoupements coté des deux côtés ; « cartographie » en tire des
                  propositions de personnes et de liens, à valider une à une.
                </p>
                <button onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#234737]">
                  <Plus className="h-3.5 w-3.5" />Lancer une analyse profonde
                </button>
              </div>
            </div>
          )}

          {courant && <DetailChantier ch={courant} feu={feu} busy={busy === courant.id} onAction={action} now={now} />}
        </main>
      </div>
    </div>
  );
}

// ── Détail d'un chantier ────────────────────────────────────────────────

function DetailChantier({ ch, feu, busy, onAction, now }: {
  ch: Chantier; feu: FeuChantiers | null; busy: boolean; onAction: (ch: Chantier, act: ActionChantier) => void; now: number;
}) {
  const badge = etatBadge(ch);
  const unite = uniteChantier(ch);
  const pct = pourcentage(ch);
  const echecs = echecsChantier(ch);
  const lotsRestants = Math.max(0, ch.totalLots - ch.lotsFaits);
  const enVol = pasEnVol(ch);
  // « Forcer » n'a de sens que sur un chantier qui a du travail devant lui et
  // qui ne tourne pas déjà à plein régime.
  const forcable = ['devis', 'pause', 'en_cours', 'synthese'].includes(ch.etat) && !ch.forceJusqu;

  return (
    <div className="space-y-3">
      {/* En-tête du chantier */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
            <IconeEtat icone={badge.icone} />{badge.label}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            {TYPE_LABEL[ch.type] || ch.type}
          </span>
          {ch.nuitSeulement && (
            <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              <Moon className="h-3 w-3" />Nuit seulement
            </span>
          )}
          {ch.forceJusqu && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              <Zap className="h-3 w-3" />Forcé jusqu&apos;à {new Date(ch.forceJusqu).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {ch.etat === 'devis' && (
              <button onClick={() => onAction(ch, 'lancer')} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737] disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Valider le devis et lancer
              </button>
            )}
            {['en_cours', 'synthese'].includes(ch.etat) && (
              <button onClick={() => onAction(ch, 'pause')} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                <PauseIcon className="h-3 w-3" />Pause
              </button>
            )}
            {ch.etat === 'pause' && (
              <button onClick={() => onAction(ch, 'lancer')} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737] disabled:opacity-50">
                <Play className="h-3 w-3" />Reprendre
              </button>
            )}
            {forcable && (
              <button onClick={() => onAction(ch, 'forcer')} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                title="Lever la fenêtre de nuit et les plafonds pendant 2 h — le dépouillement démarre tout de suite">
                <Zap className="h-3 w-3" />Forcer maintenant
              </button>
            )}
            <button onClick={() => onAction(ch, 'supprimer')} disabled={busy}
              className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
              title="Supprimer le chantier (les fiches produites restent dans le dossier)">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <h3 className="mt-2 break-words text-[15px] font-bold text-gray-900">{titreChantier(ch)}</h3>
        {ch.consigne && (
          <p className="mt-1 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11.5px] text-gray-600">
            <span className="font-semibold text-gray-700">Angle demandé :</span> {ch.consigne}
          </p>
        )}
        {ch.origine === 'attache' && (
          <p className="mt-1.5 text-[10.5px] font-semibold text-[#2B5746]">
            Devis déposé par l&apos;assistant depuis une conversation — il attend votre validation.
          </p>
        )}
        <p className="mt-1.5 text-[10.5px] text-gray-400">
          Créé le {new Date(ch.creeLe).toLocaleString('fr-FR')}
          {ch.majLe ? ` · dernier pas le ${new Date(ch.majLe).toLocaleString('fr-FR')}` : ''}
        </p>

        {ch.etat !== 'devis' && (
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-gray-600">Avancement</span>
              <span className="text-[13px] font-bold tabular-nums text-[#2B5746]">{pct} %</span>
            </div>
            <Jauge pct={pct} termine={ch.etat === 'termine'} taille="epais" />
          </div>
        )}
      </div>

      {/* Ce que l'attaché fait EN CE MOMENT — le seul endroit qui bouge tout seul.
          Plusieurs lots tournent de front : on les montre tous, pas seulement le premier. */}
      {enVol.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">
            En ce moment{enVol.length > 1 ? ` — ${enVol.length} lots de front` : ''}
          </p>
          <div className="mt-1 space-y-1">
            {enVol.map((p, i) => {
              const libelle = libelleEnCours(ch, p);
              return (
                <div key={`${p.etape}-${p.pochette || ''}-${p.lot ?? i}`} className="flex items-center gap-2.5">
                  <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-blue-600" />
                  <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-800" title={libelle || ''}>{libelle}</p>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-blue-700">depuis {dureeDepuis(p.depuis, now)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pourquoi ça n'avance pas — et quand ça repart. Un chantier resté muet
          toute une nuit ne doit plus laisser le magistrat sans explication. */}
      {ch.attente && !enVol.length && (
        <div className="flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50/70 px-3 py-2.5">
          {ch.attente === 'nuit' ? <Moon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" /> : <BatteryLow className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-gray-800">
              {ch.attente === 'nuit' ? 'En attente de la fenêtre de nuit' : 'En attente — fenêtre de 5 h saturée'}
              {ch.attenteDetail ? <span className="font-normal text-gray-600"> · {ch.attenteDetail}</span> : null}
            </p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-600">
              {ch.attente === 'nuit'
                ? `Le dépouillement repart seul à l'ouverture de la fenêtre${feu?.fenetreNuit ? ` (${feu.fenetreNuit.debut} h → ${feu.fenetreNuit.fin} h, ${feu.fuseau})` : ''}.`
                : 'Reprise automatique dès que la fenêtre glissante redescend. Le repère hebdomadaire, lui, n’arrête plus un chantier : il le fait seulement avancer un lot à la fois.'}
              {' '}« Forcer maintenant » passe outre tout de suite.
            </p>
            {ch.attenteDepuis && (
              <p className="mt-0.5 text-[10px] tabular-nums text-gray-400">Depuis {dureeDepuis(ch.attenteDepuis, now)}</p>
            )}
          </div>
        </div>
      )}

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi valeur={`${ch.piecesFaites}/${ch.totalPieces}`} libelle={unite} />
        <Kpi valeur={`${ch.lotsFaits}/${ch.totalLots}`} libelle={`lots · ${lotsRestants} restant${lotsRestants > 1 ? 's' : ''}`} />
        <Kpi valeur={ch.fiches.length + (ch.syntheseProdId ? 1 : 0)} libelle="productions" accent="text-[#2B5746]" />
        <Kpi valeur={echecs} libelle="lots en échec" accent={echecs ? 'text-red-500' : undefined} />
      </div>

      {/* Devis */}
      {ch.etat === 'devis' && ch.estimation && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
            <ClipboardList className="h-3.5 w-3.5" />Devis — à valider avant tout lancement
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi valeur={ch.estimation.pieces} libelle={unite} />
            <Kpi valeur={ch.estimation.lots} libelle={`lots (~${ch.type === 'dossier' ? '12 pièces' : '8 fiches'}/lot)`} />
            <Kpi valeur={`${fmtJetons(ch.estimation.jetonsMin)}–${fmtJetons(ch.estimation.jetonsMax)}`} libelle="jetons estimés" />
            <Kpi
              valeur={ch.estimation.heures ? `${ch.estimation.nuits} · ~${ch.estimation.heures} h` : ch.estimation.nuits}
              libelle={ch.nuitSeulement ? 'nuits de travail' : 'nuits (jour autorisé)'}
            />
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-amber-700/90">
            {ch.type === 'dossier'
              ? 'Estimation grossière — le journal donne le réel au fil de l’eau. Chaque pièce n’est lue qu’une fois : les fiches restent exploitables indéfiniment.'
              : 'Estimation grossière. Aucune pièce n’est relue : seules les fiches déjà produites sont lues, le chantier est bien plus court qu’un dépouillement.'}
            {ch.front && ch.front > 1 ? ` Durée calculée à ${ch.front} lots menés de front.` : ''}
          </p>
        </div>
      )}

      {/* Dossiers écartés faute de fiches */}
      {(ch.sansFiches || []).length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Écartés faute de fiches : {(ch.sansFiches || []).join(' · ')} — lancez d&apos;abord un chantier
            « dossier en détail » dessus, puis recréez ce chantier pour les inclure.
          </span>
        </p>
      )}

      {/* Pochettes / dossiers croisés, chacun avec sa jauge */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <p className="mb-2 text-xs font-bold text-gray-700">
          {ch.type === 'dossier' ? 'Pochettes' : 'Dossiers croisés'} <span className="font-normal text-gray-400">({ch.pochettes.length})</span>
        </p>
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {ch.pochettes.map((p) => {
            const pp = p.lots ? Math.round((p.faits / p.lots) * 100) : 0;
            return (
              <div key={p.nom}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-700" title={p.nom}>{p.nom}</span>
                  <span className="flex-shrink-0 text-[10.5px] tabular-nums text-gray-400">
                    {ch.etat === 'devis' ? `${p.pieces} ${unite}` : `${p.faits}/${p.lots} lots`}
                  </span>
                  {p.echecs > 0 && <span className="flex-shrink-0 text-[10px] font-semibold text-red-500">{p.echecs} échec{p.echecs > 1 ? 's' : ''}</span>}
                  {ch.etat !== 'devis' && p.faits >= p.lots && p.echecs === 0 && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />}
                </div>
                {ch.etat !== 'devis' && <div className="mt-0.5"><Jauge pct={pp} termine={p.faits >= p.lots && p.echecs === 0} /></div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Journal des pas */}
      {(ch.journal || []).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-bold text-gray-700">Journal du chantier</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {(ch.journal || []).slice().reverse().map((j, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed">
                <span className="flex-shrink-0 tabular-nums text-gray-400">{new Date(j.date).toLocaleString('fr-FR')}</span>
                <span className="min-w-0 text-gray-600">{j.evenement}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Productions : lisibles, éditables et exportables sur place */}
      {ch.fiches.length > 0 ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-gray-700">
            <FileText className="h-3.5 w-3.5" />
            {ch.type === 'dossier' ? 'Fiches et synthèse' : ch.type === 'liens' ? 'Tables de signalements et rapport' : 'Comptes rendus et bilan'}
            <span className="font-normal text-gray-400">({ch.fiches.length}{ch.syntheseProdId ? ' + 1' : ''})</span>
          </p>
          <ProductionsSection
            numero={ch.numero}
            titre={ch.type === 'dossier' ? 'Fiches et synthèse du chantier' : ch.type === 'liens' ? 'Tables et rapport du chantier' : 'Comptes rendus et bilan du chantier'}
            filtreSource={`chantier:${ch.id}`}
          />
        </div>
      ) : ch.etat !== 'devis' ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] text-gray-500">
          <Sparkles className="h-3.5 w-3.5 text-gray-300" />
          Aucune production pour l&apos;instant — la première fiche apparaîtra ici dès le premier lot traité.
        </p>
      ) : null}

      <p className="pb-2 text-center text-[10px] text-gray-400">
        Le moteur tourne côté serveur : fermez l&apos;atelier, il continue — la nuit par défaut, plusieurs lots de front,
        avec reprise automatique. « Forcer maintenant » lève la nuit et les plafonds pendant 2 h.
        Les productions sont aussi dans « Actes rédigés » du dossier — l&apos;attaché du dossier s&apos;appuie dessus.
      </p>
    </div>
  );
}

// ── Formulaire de lancement (→ devis) ───────────────────────────────────

function FormulaireChantier(props: {
  typeChantier: TypeChantier; setTypeChantier: (t: TypeChantier) => void;
  numero: string; setNumero: (v: string) => void;
  numeros: string[]; setNumeros: (f: (prev: string[]) => string[]) => void; ajouterNumero: () => void;
  consigne: string; setConsigne: (v: string) => void;
  nuitSeulement: boolean; setNuitSeulement: (v: boolean) => void;
  creating: boolean; onCreer: () => void; onFermer: () => void;
  enquetes: string[];
}) {
  const {
    typeChantier, setTypeChantier, numero, setNumero, numeros, setNumeros, ajouterNumero,
    consigne, setConsigne, nuitSeulement, setNuitSeulement, creating, onCreer, onFermer, enquetes,
  } = props;
  const multi = typeChantier !== 'dossier';

  return (
    <div className="mb-4 space-y-2.5 rounded-xl border border-[#2B5746]/25 bg-emerald-50/30 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-700">Nouvelle analyse profonde</p>
        <button onClick={onFermer} className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><X className="h-3.5 w-3.5" /></button>
      </div>

      {/* Les trois consommateurs du même capital : dépouiller (produit les
          fiches), croiser (rapport de recoupements), cartographier (propositions). */}
      <div className="grid gap-1.5 sm:grid-cols-3">
        {([
          { t: 'dossier', label: 'Dossier en détail', desc: 'Dépouille les pièces en fiches factuelles, puis synthèse' },
          { t: 'liens', label: 'Liens entre dossiers', desc: 'Croise les fiches de plusieurs dossiers — rapport de recoupements coté des deux côtés' },
          { t: 'carto', label: 'Cartographie', desc: 'Depuis les fiches : propositions de personnes et de liens, à valider une à une' },
        ] as const).map(({ t, label, desc }) => (
          <button
            key={t}
            onClick={() => setTypeChantier(t)}
            className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
              typeChantier === t ? 'border-[#2B5746] bg-[#2B5746] text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-[#2B5746]/40'
            }`}
          >
            <span className="block text-[11.5px] font-bold">{label}</span>
            <span className={`mt-0.5 block text-[10px] leading-snug ${typeChantier === t ? 'text-white/80' : 'text-gray-500'}`}>{desc}</span>
          </button>
        ))}
      </div>

      {multi && numeros.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {numeros.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full bg-[#2B5746]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#2B5746]">
              {n}
              <button onClick={() => setNumeros((prev) => prev.filter((x) => x !== n))} className="rounded-full p-0.5 hover:bg-[#2B5746]/15">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          list="atelier-dossiers"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && multi) { e.preventDefault(); ajouterNumero(); } }}
          placeholder={multi ? 'Numéro de dossier — Entrée ou « Ajouter » pour chacun' : 'Numéro du dossier (ex. 00387/00068/2026 - PRISON BREAK 2)'}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-[#2B5746] focus:outline-none"
        />
        {multi && (
          <button onClick={ajouterNumero} className="flex-shrink-0 rounded-lg border border-[#2B5746]/30 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50">
            Ajouter
          </button>
        )}
      </div>
      <datalist id="atelier-dossiers">
        {enquetes.map((n) => <option key={n} value={n} />)}
      </datalist>

      {multi && (
        <p className="text-[10.5px] text-amber-700/90">
          Ces chantiers lisent les FICHES produites par un chantier « dossier en détail » — jamais les pièces.
          Dépouillez d&apos;abord chaque dossier concerné.
        </p>
      )}

      <textarea
        value={consigne}
        onChange={(e) => setConsigne(e.target.value)}
        placeholder="Angle d'analyse (facultatif) — ex. « concentre-toi sur les rôles dans la livraison du 12/03, période janvier-mars »"
        rows={2}
        className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-[#2B5746] focus:outline-none"
      />
      <label className="flex items-center gap-2 text-[11px] text-gray-600">
        <input type="checkbox" checked={nuitSeulement} onChange={(e) => setNuitSeulement(e.target.checked)} className="h-3.5 w-3.5 accent-[#2B5746]" />
        Travailler uniquement la nuit (préserve le forfait de la journée)
      </label>
      <div className="flex items-center gap-2">
        <p className="mr-auto text-[10.5px] text-gray-400">
          Le devis (pochettes, pièces, estimation) s&apos;affiche AVANT tout dépouillement — rien ne se lance sans votre validation.
        </p>
        <button
          onClick={onCreer}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#234737] disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Établir le devis
        </button>
      </div>
    </div>
  );
}
