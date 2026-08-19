'use client';

/**
 * SIRAL — Chantiers d'analyse profonde (page Assistant de justice).
 *
 * La BANDE de tête : d'un coup d'œil, où en sont les dépouillements — état,
 * avancement, ce qui attend une validation. Tout le détail (devis chiffré,
 * pochette par pochette, journal des pas, fiches et synthèses lisibles sur
 * place) s'ouvre en PLEIN ÉCRAN dans l'atelier : c'est là que le magistrat
 * travaille, sans empiler les accordéons dans la page.
 *
 * Visible du SEUL administrateur (se masque si /api/attache/chantiers ≠ 200).
 * Le moteur tourne côté service attaché : fermer cette page ne change rien.
 */
import { useState } from 'react';
import {
  Layers, Plus, Maximize2, Play, Pause as PauseIcon, Moon, BatteryLow,
  CheckCircle2, ChevronRight,
} from 'lucide-react';
import { ChantiersAtelier } from './ChantiersAtelier';
import {
  useChantiers, etatBadge, uniteChantier, titreChantier, pourcentage, dureeDepuis,
  libelleEnCours, type Chantier,
} from './useChantiers';

function IconeEtat({ icone }: { icone?: 'nuit' | 'forfait' | 'fini' }) {
  if (icone === 'nuit') return <Moon className="h-3 w-3" />;
  if (icone === 'forfait') return <BatteryLow className="h-3 w-3" />;
  if (icone === 'fini') return <CheckCircle2 className="h-3 w-3" />;
  return null;
}

/** L'ordre de lecture : ce qui attend le magistrat d'abord, l'archive ensuite. */
const RANG: Record<Chantier['etat'], number> = { devis: 0, en_cours: 1, synthese: 1, pause: 2, termine: 3 };

export function ChantiersSection() {
  const { available, chantiers, busy, action, load, now } = useChantiers();
  const [atelier, setAtelier] = useState<{ selection: string | null; formulaire: boolean } | null>(null);

  if (!available) return null;

  const enCours = chantiers.filter((c) => ['en_cours', 'synthese'].includes(c.etat)).length;
  const devis = chantiers.filter((c) => c.etat === 'devis').length;
  const termines = chantiers.filter((c) => c.etat === 'termine').length;
  const ordonnes = [...chantiers].sort((a, b) => (RANG[a.etat] - RANG[b.etat]) || (b.majLe || b.creeLe).localeCompare(a.majLe || a.creeLe));

  return (
    <>
      <div className="rounded-xl border border-[#2B5746]/25 bg-white shadow-sm">
        {/* En-tête : l'état du parc en une ligne */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <Layers className="h-4 w-4 flex-shrink-0 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Analyses profondes</span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">vous seul</span>
          {devis > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{devis} devis à valider</span>
          )}
          {enCours > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{enCours} en cours</span>
          )}
          {termines > 0 && (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{termines} terminé{termines > 1 ? 's' : ''}</span>
          )}
          <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            <button
              onClick={() => setAtelier({ selection: null, formulaire: false })}
              className="inline-flex items-center gap-1 rounded-lg border border-[#2B5746]/30 px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50"
            >
              <Maximize2 className="h-3.5 w-3.5" />Ouvrir l&apos;atelier
            </button>
            <button
              onClick={() => setAtelier({ selection: null, formulaire: true })}
              className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737]"
            >
              <Plus className="h-3.5 w-3.5" />Nouvelle analyse
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          {chantiers.length === 0 ? (
            <p className="py-2 text-center text-xs leading-relaxed text-gray-400">
              Aucun chantier. Trois types : « dossier en détail » dépouille un dossier entier en fiches factuelles
              (la nuit, par lots, interruptible) puis en tire une synthèse ; « liens entre dossiers » croise les fiches
              de plusieurs dossiers en un rapport de recoupements ; « cartographie » en tire des propositions à valider.
            </p>
          ) : (
            <div className="space-y-1">
              {ordonnes.map((ch) => {
                const badge = etatBadge(ch);
                const pct = pourcentage(ch);
                const enCours = libelleEnCours(ch);
                return (
                  <div key={ch.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-gray-50">
                    <button
                      onClick={() => setAtelier({ selection: ch.id, formulaire: false })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title="Ouvrir dans l'atelier"
                    >
                      <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                        <IconeEtat icone={badge.icone} />{badge.label}
                      </span>
                      {ch.type !== 'dossier' && (
                        <span className="flex-shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-indigo-600">
                          {ch.type === 'liens' ? 'Liens' : 'Carto'}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800" title={titreChantier(ch)}>{titreChantier(ch)}</span>
                      <span className="hidden w-40 flex-shrink-0 sm:block">
                        {ch.etat !== 'devis' && (
                          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                            <span
                              className={`block h-full rounded-full ${ch.etat === 'termine' ? 'bg-emerald-500' : 'bg-[#2B5746]'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        )}
                      </span>
                      <span className="flex-shrink-0 text-[10.5px] tabular-nums text-gray-400">
                        {ch.etat === 'devis'
                          ? `${ch.totalPieces} ${uniteChantier(ch)} · ${ch.totalLots} lots`
                          : `${pct} % · ${ch.piecesFaites}/${ch.totalPieces} ${uniteChantier(ch)}`}
                      </span>
                      {/* Le pas qui tourne : la seule chose qui bouge toute seule dans la bande */}
                      {enCours && (
                        <span className="hidden max-w-[220px] flex-shrink-0 items-center gap-1 text-[10px] text-blue-700 lg:flex" title={enCours}>
                          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-500" />
                          <span className="truncate">{enCours}</span>
                          <span className="flex-shrink-0 tabular-nums text-blue-500">· {dureeDepuis(ch.enCours?.depuis || '', now)}</span>
                        </span>
                      )}
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {(ch.etat === 'devis' || ch.etat === 'pause') && (
                        <button onClick={() => action(ch, 'lancer')} disabled={busy === ch.id}
                          className="inline-flex items-center gap-1 rounded-md bg-[#2B5746] px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-[#234737] disabled:opacity-50">
                          <Play className="h-3 w-3" />{ch.etat === 'devis' ? 'Lancer' : 'Reprendre'}
                        </button>
                      )}
                      {['en_cours', 'synthese'].includes(ch.etat) && (
                        <button onClick={() => action(ch, 'pause')} disabled={busy === ch.id}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <PauseIcon className="h-3 w-3" />Pause
                        </button>
                      )}
                      <button
                        onClick={() => setAtelier({ selection: ch.id, formulaire: false })}
                        className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                        title="Ouvrir dans l'atelier"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {atelier && (
        <ChantiersAtelier
          selection={atelier.selection}
          onSelection={(id) => setAtelier((a) => (a ? { ...a, selection: id } : a))}
          ouvrirFormulaire={atelier.formulaire}
          // fermer l'atelier remet la bande à jour : ce qu'on y a lancé ou
          // supprimé se voit tout de suite, sans attendre le prochain sondage
          onClose={() => { setAtelier(null); load(); }}
        />
      )}
    </>
  );
}
