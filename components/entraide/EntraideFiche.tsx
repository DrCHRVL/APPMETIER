'use client';

// Fiche d'une demande d'entraide : où en est le dossier, qui l'a, ce qu'il
// reste à faire. La chronologie se remplit par les boutons ; seules les dates
// se corrigent à la main.

import React, { useMemo, useState } from 'react';
import { X, Trash2, Download, Mail, Copy, Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useToast } from '@/contexts/ToastContext';
import { copyPlainToClipboard } from '@/utils/richTextExport';
import {
  ajouterMois,
  aujourdhui,
  dateFr,
  DOC_LABELS,
  etatDemande,
  EVENEMENT_LABELS,
  MESURES,
  prochainesActions,
  SENS_LABELS,
  TYPE_LABELS,
  PAYS,
} from '@/utils/entraide/logique';
import { languesDisponibles } from '@/utils/entraide/documents';
import { lienMailto, mailsDemande } from '@/utils/entraide/mails';
import { lignesDemande } from '@/utils/entraide/textes';
import { actionAvecFormulaire, executerAction, signataireDe, telechargerCourrier } from './actionsEntraide';
import { AutoriteSelect } from './AutoriteSelect';
import { MesuresInput } from './MesuresInput';
import { BadgeEcheance, BadgeType } from './badges';
import { nomUtilisateur, utilisateursEntraide } from './utilisateurs';
import { nouvelId, type EntraideApi } from '@/hooks/useEntraide';
import type { EntraideAction, EntraideDocId, EntraideLangue } from '@/types/entraideTypes';

interface Props {
  api: EntraideApi;
  demandeId: string;
  onClose: () => void;
}

const ETAPES_RECUE = ['Réception', 'Soit-transmis', 'Enquêteurs', 'Avis du magistrat', 'Retour à l’autorité', 'AR international', 'Clôture'];
const ETAPES_EMISE = ['Enregistrement', 'Traduction', 'Envoi', 'Attente de l’étranger', 'Exécution reçue', 'Clôture'];

function indexEtape(sens: 'recue' | 'emise', etape: string, doc?: EntraideDocId): number {
  if (sens === 'recue') {
    const m: Record<string, number> = { a_traiter: 1, en_traduction: 1, chez_enqueteurs: 2, avis_magistrat: 3, attente_ar: 5, a_cloturer: 6, cloturee: 7 };
    if (etape === 'a_signer' || etape === 'a_envoyer') return doc === 't3' ? 4 : doc === 't2' ? 2 : 1;
    return m[etape] ?? 1;
  }
  const m: Record<string, number> = { a_traiter: 2, en_traduction: 1, attente_etranger: 3, a_signer: 3, a_envoyer: 3, avis_magistrat: 4, cloturee: 6 };
  return m[etape] ?? 2;
}

export const EntraideFiche: React.FC<Props> = ({ api, demandeId, onClose }) => {
  const { showToast } = useToast();
  useEscapeKey(onClose);
  const d = api.data.demandes.find((x) => x.id === demandeId);
  const [formulaire, setFormulaire] = useState<EntraideAction | null>(null);
  const [langue, setLangue] = useState<EntraideLangue>('fr');
  const [delai, setDelai] = useState<{ mois: number; date: string }>({ mois: 3, date: '' });
  const [edition, setEdition] = useState(false);
  const [note, setNote] = useState('');
  const [legale, setLegale] = useState({ date: '', libelle: '' });
  const [confirmSuppr, setConfirmSuppr] = useState(false);

  const jour = aujourdhui();
  const etat = useMemo(() => (d ? etatDemande(d, jour) : null), [d, jour]);
  const actions = useMemo(() => (d && etat ? prochainesActions(d, etat) : []), [d, etat]);
  const frequences = useMemo(() => {
    const f: Record<string, number> = {};
    for (const x of api.data.demandes) for (const m of x.mesures || []) f[m] = (f[m] || 0) + 1;
    return f;
  }, [api.data.demandes]);
  if (!d || !etat) return null;

  const autorite = (d.autoriteId && api.index.autorite.get(d.autoriteId)) || null;
  const service = (d.serviceId && api.index.service.get(d.serviceId)) || null;
  const monSignataire = api.index.signataire.get(api.moi.toLowerCase()) || null;
  const ctx = { api, demande: d, monSignataire, notifier: showToast };
  const evenements = [...d.evenements].sort((a, b) => b.date.localeCompare(a.date) || b.creeLe.localeCompare(a.creeLe));
  const etapes = d.sens === 'recue' ? ETAPES_RECUE : ETAPES_EMISE;
  const idx = indexEtape(d.sens, etat.etape, etat.docEnAttente?.doc);
  const docs: EntraideDocId[] = d.sens === 'recue' ? ['t1', 't2', 't3'] : ['t4'];
  const mails = mailsDemande(d, { autorite, service, signataire: monSignataire || signataireDe(api, d) });

  const lancer = async (a: EntraideAction) => {
    if (actionAvecFormulaire(a)) {
      setLangue(autorite?.langue || 'fr');
      setFormulaire(a);
      return;
    }
    try { await executerAction(ctx, a); } catch (e) { showToast(e instanceof Error ? e.message : 'Échec', 'error'); }
  };

  const confirmerFormulaire = async () => {
    if (!formulaire) return;
    await executerAction(ctx, formulaire, { langue, delaiMois: delai.mois, echeance: delai.date || undefined });
    setFormulaire(null);
  };

  /** Signature associée au dernier courrier de ce type (pour retélécharger la version signée). */
  const signePour = (doc: EntraideDocId): string | undefined => {
    const evs = [...d.evenements].sort((a, b) => a.date.localeCompare(b.date) || a.creeLe.localeCompare(b.creeLe));
    let signe: string | undefined;
    for (const e of evs) {
      if (e.type === 'document_prepare' && e.doc === doc) signe = undefined;
      if (e.type === 'signature' && e.doc === doc) signe = e.par;
    }
    return signe;
  };

  const champ = 'w-full rounded-md border px-2 py-1 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[96vw] max-w-[1180px] max-h-[94vh] flex flex-col">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <BadgeType type={d.type} />
              <span className="font-semibold">{d.sens === 'recue' ? `← reçue de ${d.pays}` : `émise vers ${d.pays} →`}</span>
              <BadgeEcheance etat={etat} />
            </div>
            <h2 className="mt-1 text-base font-semibold text-gray-900 truncate">
              <span className="font-mono">{d.refEsabora}</span>{d.objet ? ` · ${d.objet}` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {confirmSuppr ? (
              <>
                <span className="text-xs text-red-700 mr-1">Supprimer définitivement ?</span>
                <Button size="sm" variant="destructive" onClick={async () => { await api.supprimerDemande(d.id); onClose(); }}>Oui</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmSuppr(false)}>Non</Button>
              </>
            ) : (
              <button onClick={() => setConfirmSuppr(true)} className="p-1.5 rounded-lg hover:bg-red-50" title="Supprimer la demande"><Trash2 className="h-4 w-4 text-gray-400" /></button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="h-5 w-5 text-gray-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/60">
          {/* Étapes */}
          <div className="flex items-start rounded-lg border bg-white px-3 pt-3 pb-2">
            {etapes.map((l, i) => {
              const fait = i < idx;
              const cour = i === idx && etat.etape !== 'cloturee';
              return (
                <div key={l} className="flex-1 text-center relative text-[11px]">
                  {i > 0 && <div className={`absolute top-2.5 right-1/2 left-[-50%] h-0.5 ${fait || cour ? 'bg-[#2B5746]' : 'bg-gray-200'}`} />}
                  <div className={`relative z-10 mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold
                    ${fait ? 'bg-[#2B5746] border-[#2B5746] text-white' : cour ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-white border-gray-300 text-gray-400'}`}>
                    {fait ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className={cour ? 'font-semibold text-gray-900' : fait ? 'text-gray-700' : 'text-gray-400'}>{l}</span>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1">
              {etat.libelleEtape}{etat.chez !== 'aucun' ? ` · chez ${etat.chez === 'enqueteurs' ? (service?.libelle || d.serviceAutre || 'les enquêteurs') : etat.chez === 'magistrat' ? (nomUtilisateur(d.magistrat) || 'le magistrat') : etat.chez === 'autorite' ? 'l’autorité étrangère' : etat.chez}` : ''}
            </span>
            {actions.map((a) => (
              <Button key={`${a.action}:${a.doc || ''}`} size="sm" variant={a.primaire ? 'default' : 'outline'}
                className={a.primaire ? 'bg-[#2B5746] hover:bg-[#2B5746]/90' : ''}
                onClick={() => lancer(a)}>
                {a.libelle}
              </Button>
            ))}
          </div>
          {formulaire && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 flex flex-wrap items-end gap-3 text-sm">
              {formulaire.action === 'prorogation' ? (
                <>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Nouveau délai</div>
                    <div className="flex gap-1">
                      {[3, 4, 6].map((m) => (
                        <button key={m} type="button" onClick={() => setDelai({ mois: m, date: '' })}
                          className={`px-2.5 py-1 rounded border text-xs ${!delai.date && delai.mois === m ? 'bg-gray-900 text-white' : 'bg-white'}`}>{m} mois</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">… ou à représenter le</div>
                    <input type="date" className="rounded border px-2 py-1 text-xs" value={delai.date} onChange={(e) => setDelai({ ...delai, date: e.target.value })} />
                  </div>
                  <span className="text-xs text-gray-500">Échéance : {dateFr(delai.date || ajouterMois(jour, delai.mois) || '')}</span>
                </>
              ) : (
                <div>
                  <div className="text-xs text-gray-600 mb-1">{DOC_LABELS[formulaire.doc!]} — langue</div>
                  <div className="flex gap-1">
                    {(['fr', 'en'] as EntraideLangue[]).map((l) => (
                      <button key={l} type="button" onClick={() => setLangue(l)}
                        className={`px-2.5 py-1 rounded border text-xs ${langue === l ? 'bg-gray-900 text-white' : 'bg-white'}`}>{l === 'fr' ? 'Français' : 'Anglais'}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setFormulaire(null)}>Annuler</Button>
                <Button size="sm" onClick={confirmerFormulaire}>Valider</Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Identification */}
            <div className="rounded-lg border bg-white p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Identification</h3>
                <button className="text-xs text-blue-700 hover:underline" onClick={() => setEdition(!edition)}>{edition ? 'Terminer' : 'Modifier'}</button>
              </div>
              {edition ? (
                <div className="space-y-2">
                  <label className="block text-xs text-gray-500">N/réf (ESABORA)<input className={champ} value={d.refEsabora} onChange={(e) => api.modifierDemande(d.id, { refEsabora: e.target.value })} /></label>
                  <label className="block text-xs text-gray-500">V/réf<input className={champ} value={d.refEtrangere || ''} onChange={(e) => api.modifierDemande(d.id, { refEtrangere: e.target.value })} /></label>
                  <label className="block text-xs text-gray-500">Pays
                    <select className={champ} value={d.pays} onChange={(e) => api.modifierDemande(d.id, { pays: e.target.value })}>
                      {!PAYS.some((p) => p.nom === d.pays) && <option value={d.pays}>{d.pays}</option>}
                      {PAYS.map((p) => <option key={p.nom} value={p.nom}>{p.nom}</option>)}
                    </select>
                  </label>
                  <div className="text-xs text-gray-500">Autorité
                    <AutoriteSelect autorites={api.data.autorites} pays={d.pays} valeur={autorite}
                      onChoisir={(a, q) => { api.modifierDemande(d.id, { autoriteId: a?.id, autoriteNom: a?.nom }); if (a && q) api.apprendreAutorite(a.id, q); }}
                      onCreer={(a) => api.enregistrerAutorite(a)} />
                  </div>
                  <label className="block text-xs text-gray-500">Objet<input className={champ} value={d.objet} onChange={(e) => api.modifierDemande(d.id, { objet: e.target.value })} /></label>
                  <label className="block text-xs text-gray-500">Personne(s) visée(s)<input className={champ} value={d.personnes || ''} onChange={(e) => api.modifierDemande(d.id, { personnes: e.target.value })} /></label>
                  <div className="text-xs text-gray-500">Mesures<MesuresInput valeur={d.mesures || []} onChange={(m) => api.modifierDemande(d.id, { mesures: m })} frequences={frequences} /></div>
                  {d.sens === 'recue' && (
                    <label className="block text-xs text-gray-500">Service enquêteur
                      <select className={champ} value={d.serviceAutre ? '__autre' : d.serviceId || ''} onChange={(e) => api.modifierDemande(d.id, e.target.value === '__autre' ? { serviceId: undefined, serviceAutre: d.serviceAutre || 'À préciser' } : { serviceId: e.target.value || undefined, serviceAutre: undefined })}>
                        <option value="">—</option>
                        {api.data.services.filter((s) => !s.inactif || s.id === d.serviceId).map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}
                        <option value="__autre">Autre unité…</option>
                      </select>
                      {d.serviceAutre !== undefined && <input className={`${champ} mt-1`} value={d.serviceAutre} onChange={(e) => api.modifierDemande(d.id, { serviceAutre: e.target.value })} />}
                    </label>
                  )}
                  <label className="block text-xs text-gray-500">Magistrat en charge
                    <select className={champ} value={d.magistrat || ''} onChange={(e) => api.modifierDemande(d.id, { magistrat: e.target.value || undefined })}>
                      <option value="">—</option>
                      {utilisateursEntraide().map((u) => <option key={u.windowsUsername} value={u.windowsUsername}>{u.displayName}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-gray-500">Paragraphe « Bien vouloir… » (une ligne par mesure)
                    <textarea className={champ} rows={4} value={d.texteMesures ?? lignesDemande(d).join('\n')} onChange={(e) => api.modifierDemande(d.id, { texteMesures: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">Observations<textarea className={champ} rows={2} value={d.observations || ''} onChange={(e) => api.modifierDemande(d.id, { observations: e.target.value })} /></label>
                </div>
              ) : (
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
                  <dt className="text-gray-500">N/réf</dt><dd className="font-mono">{d.refEsabora}</dd>
                  <dt className="text-gray-500">V/réf</dt><dd>{d.refEtrangere || '—'}</dd>
                  <dt className="text-gray-500">Type</dt><dd>{TYPE_LABELS[d.type]} · {SENS_LABELS[d.sens]}</dd>
                  <dt className="text-gray-500">Autorité</dt><dd>{autorite?.nom || d.autoriteNom || '—'}</dd>
                  {d.sens === 'recue' && (<><dt className="text-gray-500">Service saisi</dt><dd>{service?.libelle || d.serviceAutre || '—'}</dd></>)}
                  <dt className="text-gray-500">Personnes</dt><dd>{d.personnes || '—'}</dd>
                  <dt className="text-gray-500">Mesures</dt><dd>{(d.mesures || []).map((id) => MESURES.find((m) => m.id === id)?.libelle || id).join(', ') || '—'}</dd>
                  <dt className="text-gray-500">Magistrat</dt><dd className="font-medium">{nomUtilisateur(d.magistrat) || '—'}</dd>
                  {d.observations && (<><dt className="text-gray-500">Observations</dt><dd className="whitespace-pre-wrap">{d.observations}</dd></>)}
                  {d.origine && (<><dt className="text-gray-500">Origine</dt><dd className="text-gray-500">Excel · {d.origine.onglet} l. {d.origine.ligne}</dd></>)}
                </dl>
              )}
            </div>

            {/* Échéances */}
            <div className="rounded-lg border bg-white p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Échéances</h3>
              {etat.echeance ? (
                <div className="flex items-center justify-between py-1.5 border-b border-dashed">
                  <span>{etat.echeance.libelle}</span>
                  <span className={etat.echeance.date < jour ? 'text-red-700 font-semibold' : 'text-gray-800'}>{dateFr(etat.echeance.date)}</span>
                </div>
              ) : (
                <div className="py-1.5 border-b border-dashed text-gray-500">{etat.etape === 'cloturee' ? `Clôturée le ${dateFr(etat.dateCloture)}` : 'Aucune échéance interne en cours'}</div>
              )}
              {etat.echeancesLegales.map((l) => (
                <div key={l.code} className="flex items-center justify-between gap-2 py-1.5 border-b border-dashed last:border-0">
                  <span><b className="text-gray-700">Légal</b> · {l.libelle}</span>
                  <span className={`text-xs whitespace-nowrap ${l.statut === 'depasse' ? 'text-red-700 font-semibold' : l.statut === 'depasse_fait' ? 'text-amber-700' : l.statut === 'respecte' ? 'text-green-700' : 'text-gray-700'}`}>
                    {l.statut === 'respecte' ? `tenu (${dateFr(l.faitLe)})` : l.statut === 'depasse_fait' ? `fait hors délai (${dateFr(l.faitLe)})` : l.statut === 'non_renseigne' ? 'non renseigné' : dateFr(l.date)}
                  </span>
                </div>
              ))}
              {etat.echeancesLegales.some((l) => l.code === 'execution_dee' && l.statut === 'depasse') && (
                <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">Délai d’exécution dépassé : informer l’autorité d’émission du retard et du délai prévisible (art. 12 § 6 dir. 2014/41/UE).</p>
              )}
              <div className="mt-3 flex gap-1.5">
                <input type="date" className="rounded border px-2 py-1 text-xs" value={legale.date} onChange={(e) => setLegale({ ...legale, date: e.target.value })} />
                <input className="flex-1 rounded border px-2 py-1 text-xs" placeholder="Échéance légale (prescription…)" value={legale.libelle} onChange={(e) => setLegale({ ...legale, libelle: e.target.value })} />
                <button className="rounded border px-2 text-xs disabled:opacity-40" disabled={!legale.date}
                  onClick={async () => {
                    await api.modifierDemande(d.id, { echeancesLegales: [...(d.echeancesLegales || []), { id: nouvelId('l'), date: legale.date, libelle: legale.libelle || 'Échéance légale' }] });
                    setLegale({ date: '', libelle: '' });
                  }}><Plus className="h-3.5 w-3.5" /></button>
              </div>
              {(d.echeancesLegales || []).length > 0 && (
                <div className="mt-1 text-[11px] text-gray-500">
                  {(d.echeancesLegales || []).map((l) => (
                    <span key={l.id} className="mr-2">{l.libelle} <button className="text-red-600" onClick={() => api.modifierDemande(d.id, { echeancesLegales: (d.echeancesLegales || []).filter((x) => x.id !== l.id) })}>×</button></span>
                  ))}
                </div>
              )}
            </div>

            {/* Chronologie */}
            <div className="rounded-lg border bg-white p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Chronologie</h3>
              <div className="flex gap-1.5 mb-3">
                <input className="flex-1 rounded border px-2 py-1 text-xs" placeholder="Ajouter une note…" value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={async (e) => { if (e.key === 'Enter' && note.trim()) { await api.ajouterEvenement(d.id, { type: 'note', date: jour, note: note.trim() }); setNote(''); } }} />
              </div>
              <ol className="relative border-l border-gray-200 ml-1.5 space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {evenements.map((e) => (
                  <li key={e.id} className="ml-3 group">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#5b63d6] bg-white" />
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <input type="date" className="bg-transparent text-[11px] w-[108px]" value={e.date} onChange={(ev) => ev.target.value && api.modifierEvenement(d.id, e.id, { date: ev.target.value })} />
                      {e.par && <span>· {nomUtilisateur(e.par)}</span>}
                      <button className="ml-auto opacity-0 group-hover:opacity-100 text-red-600" title="Retirer cet événement" onClick={() => api.supprimerEvenement(d.id, e.id)}>×</button>
                    </div>
                    <div className="text-[13px] text-gray-800">
                      {EVENEMENT_LABELS[e.type]}{e.doc ? ` — ${e.doc.toUpperCase()}${e.langue === 'en' ? ' (EN)' : ''}` : ''}{e.partiel ? ' (partiel)' : ''}
                      {e.echeance ? ` → ${dateFr(e.echeance)}` : e.delaiMois ? ` (${e.delaiMois} mois)` : ''}
                    </div>
                    {e.note && <div className="text-xs text-gray-600 whitespace-pre-wrap">{e.note}</div>}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Courriers et mails */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border bg-white p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Courriers</h3>
              <div className="space-y-1.5">
                {docs.map((doc) => {
                  const signe = signePour(doc);
                  return (
                    <div key={doc} className="flex items-center justify-between gap-2">
                      <span>{DOC_LABELS[doc]}{signe ? <span className="ml-1 text-[11px] text-green-700">· signé</span> : null}</span>
                      <div className="flex gap-1">
                        {languesDisponibles(doc).map((l) => (
                          <button key={l} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                            onClick={() => telechargerCourrier(api, d, doc, l, signe).catch((e) => showToast(e.message, 'error'))}>
                            <Download className="h-3 w-3" />{l.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">Fichier .odt (LibreOffice / Word). Version signée uniquement après « Valider et signer » par le magistrat.</p>
            </div>
            <div className="rounded-lg border bg-white p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Mails prêts à envoyer</h3>
              <div className="space-y-1.5">
                {mails.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <span className="truncate" title={m.objet}>{m.libelle}</span>
                    <div className="flex gap-1">
                      <button className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                        onClick={async () => { const ok = await copyPlainToClipboard(`Objet : ${m.objet}\n\n${m.corps}`); showToast(ok ? 'Mail copié' : 'Copie impossible', ok ? 'success' : 'error'); }}>
                        <Copy className="h-3 w-3" />Copier
                      </button>
                      <a className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50" href={lienMailto(m)}>
                        <Mail className="h-3 w-3" />Outlook
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">Objet et références remplis ; les pièces jointes restent à ajouter.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
