'use client';

// Module « Entraide internationale » : registre partagé des demandes
// d'entraide (DEE, DO, CRI, exécution, civil), reçues ou émises, triées par
// urgence. Onglets : registre, parapheur (à signer), relances par service,
// clôturées, référentiels, signature.

import React, { useMemo, useState } from 'react';
import { Plus, RefreshCw, Mail, Copy, Download, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { useEntraide } from '@/hooks/useEntraide';
import { copyPlainToClipboard } from '@/utils/richTextExport';
import {
  aujourdhui,
  cleUrgence,
  dateFr,
  DOC_LABELS,
  etatDemande,
  normaliser,
  prochainesActions,
  texteRecherche,
  TYPE_LABELS,
} from '@/utils/entraide/logique';
import { lienMailto, mailRelanceGroupee } from '@/utils/entraide/mails';
import { actionAvecFormulaire, executerAction, telechargerCourrier } from '@/components/entraide/actionsEntraide';
import { BadgeEcheance, BadgeType } from '@/components/entraide/badges';
import { EntraideFiche } from '@/components/entraide/EntraideFiche';
import { NouvelleDemandeModal } from '@/components/entraide/NouvelleDemandeModal';
import { ReferentielsPanel } from '@/components/entraide/ReferentielsPanel';
import { SignaturePanel } from '@/components/entraide/SignaturePanel';
import { nomUtilisateur, utilisateursEntraide } from '@/components/entraide/utilisateurs';
import type { DemandeEntraide, EntraideEtat, EntraideType, ServiceEnqueteur } from '@/types/entraideTypes';

type Onglet = 'registre' | 'signer' | 'relances' | 'cloturees' | 'referentiels' | 'signature';

interface Ligne { d: DemandeEntraide; e: EntraideEtat }

const CHEZ_LIBELLES: Record<string, string> = {
  greffe: 'Greffe', magistrat: 'Magistrat', enqueteurs: 'Enquêteurs', traduction: 'Traduction', autorite: 'Étranger', aucun: '—',
};

export const EntraidePage: React.FC<{ searchTerm?: string }> = ({ searchTerm = '' }) => {
  const api = useEntraide();
  const { showToast } = useToast();
  const [onglet, setOnglet] = useState<Onglet>('registre');
  const [type, setType] = useState<EntraideType | ''>('');
  const [sens, setSens] = useState<'' | 'recue' | 'emise'>('');
  const [magistrat, setMagistrat] = useState('');
  const [recherche, setRecherche] = useState('');
  const [ficheId, setFicheId] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const jour = aujourdhui();
  const lignes: Ligne[] = useMemo(
    () => api.data.demandes.map((d) => ({ d, e: etatDemande(d, jour) })),
    [api.data.demandes, jour],
  );
  const enCours = lignes.filter((l) => l.e.etape !== 'cloturee');
  const aSigner = enCours.filter((l) => l.e.etape === 'a_signer');
  const monSignataire = api.index.signataire.get(api.moi.toLowerCase()) || null;

  const q = normaliser(recherche || searchTerm);
  const filtre = (l: Ligne) =>
    (!type || l.d.type === type)
    && (!sens || l.d.sens === sens)
    && (!magistrat || (magistrat === '__moi' ? (l.d.magistrat || '').toLowerCase() === api.moi.toLowerCase() : l.d.magistrat === magistrat))
    && (!q || texteRecherche(l.d, `${l.d.autoriteId ? api.index.autorite.get(l.d.autoriteId)?.nom || '' : ''} ${l.d.serviceId ? api.index.service.get(l.d.serviceId)?.libelle || '' : ''}`).includes(q));
  const registre = enCours.filter(filtre).sort((a, b) => cleUrgence(a.e) - cleUrgence(b.e));
  const cloturees = lignes.filter((l) => l.e.etape === 'cloturee').filter(filtre)
    .sort((a, b) => (b.e.dateCloture || '').localeCompare(a.e.dateCloture || ''));

  const kpi = {
    retard: enCours.filter((l) => l.e.niveau === 'retard').length,
    proche: enCours.filter((l) => l.e.niveau === 'proche').length,
    signer: aSigner.length,
    legal: enCours.filter((l) => l.e.echeancesLegales.some((x) => x.statut === 'en_cours' || x.statut === 'depasse')).length,
    sansEcheance: enCours.filter((l) => l.e.niveau === 'aucune').length,
  };

  // Relances groupées : demandes reçues en retard chez un même service.
  const relancesParService = useMemo(() => {
    const m = new Map<string, { service: ServiceEnqueteur; lignes: Ligne[] }>();
    for (const l of enCours) {
      if (l.e.etape !== 'chez_enqueteurs' || l.e.niveau !== 'retard') continue;
      const s: ServiceEnqueteur = (l.d.serviceId && api.index.service.get(l.d.serviceId))
        || { id: `autre:${l.d.serviceAutre || 'non renseigné'}`, libelle: l.d.serviceAutre || 'Service non renseigné', cases: ['autre'], dateMiseAJour: '' };
      const g = m.get(s.id) || { service: s, lignes: [] };
      g.lignes.push(l);
      m.set(s.id, g);
    }
    return Array.from(m.values()).sort((a, b) => b.lignes.length - a.lignes.length);
  }, [enCours, api.index.service]);
  const etrangerEnRetard = enCours.filter((l) => l.e.etape === 'attente_etranger' && l.e.niveau === 'retard');

  const lancer = async (l: Ligne) => {
    const a = prochainesActions(l.d, l.e).find((x) => x.primaire);
    if (!a || actionAvecFormulaire(a)) { setFicheId(l.d.id); return; }
    try {
      await executerAction({ api, demande: l.d, monSignataire, notifier: showToast }, a);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec', 'error');
    }
  };

  const Onglets: Array<[Onglet, string, number?]> = [
    ['registre', 'Registre', enCours.length],
    ['signer', 'À signer', aSigner.length],
    ['relances', 'Relances', relancesParService.reduce((n, g) => n + g.lignes.length, 0) + etrangerEnRetard.length],
    ['cloturees', 'Clôturées'],
    ['referentiels', 'Référentiels'],
    ['signature', 'Ma signature'],
  ];

  const chip = (actif: boolean) => `px-2.5 py-0.5 rounded-full border text-xs ${actif ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'}`;

  const tableau = (rows: Ligne[], cloture = false) => (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">{cloture ? 'Clôture' : 'Échéance'}</th><th className="px-2">Type</th><th className="px-2">Sens</th>
            <th className="px-2">N/réf</th><th className="px-2">Pays</th><th className="px-2">Objet</th>
            {!cloture && <><th className="px-2">Chez</th><th className="px-2">Étape</th></>}
            <th className="px-2">Magistrat</th>{!cloture && <th className="px-2">Prochaine étape</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const a = cloture ? null : prochainesActions(l.d, l.e).find((x) => x.primaire);
            return (
              <tr key={l.d.id} className={`border-t cursor-pointer hover:bg-gray-50 ${l.e.niveau === 'retard' ? 'bg-red-50/40' : ''}`} onClick={() => setFicheId(l.d.id)}>
                <td className="px-3 py-1.5">{cloture ? dateFr(l.e.dateCloture) : <BadgeEcheance etat={l.e} />}</td>
                <td className="px-2"><BadgeType type={l.d.type} /></td>
                <td className="px-2 whitespace-nowrap text-xs font-semibold">{l.d.sens === 'recue' ? '← reçue' : 'émise →'}</td>
                <td className="px-2 font-mono text-xs whitespace-nowrap">{l.d.refEsabora}</td>
                <td className="px-2">{l.d.pays}</td>
                <td className="px-2 max-w-[320px] truncate" title={l.d.objet}>{l.d.objet}</td>
                {!cloture && <><td className="px-2 text-xs">{CHEZ_LIBELLES[l.e.chez]}</td><td className="px-2 text-xs">{l.e.libelleEtape}</td></>}
                <td className="px-2 text-xs whitespace-nowrap">{nomUtilisateur(l.d.magistrat)}</td>
                {!cloture && (
                  <td className="px-2 py-1" onClick={(ev) => ev.stopPropagation()}>
                    {a && (
                      <button className="whitespace-nowrap rounded-md border border-[#2B5746]/40 bg-[#2B5746]/5 px-2 py-0.5 text-xs text-[#2B5746] hover:bg-[#2B5746]/10"
                        onClick={() => lancer(l)}>{a.libelle}</button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">Aucune demande.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  const Filtres = (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <button className={chip(!type)} onClick={() => setType('')}>Toutes</button>
      {(Object.keys(TYPE_LABELS) as EntraideType[]).map((t) => <button key={t} className={chip(type === t)} onClick={() => setType(t)}>{TYPE_LABELS[t]}</button>)}
      <span className="w-2" />
      <button className={chip(sens === 'recue')} onClick={() => setSens(sens === 'recue' ? '' : 'recue')}>Reçues</button>
      <button className={chip(sens === 'emise')} onClick={() => setSens(sens === 'emise' ? '' : 'emise')}>Émises</button>
      <select className="rounded-full border px-2 py-0.5 text-xs" value={magistrat} onChange={(e) => setMagistrat(e.target.value)}>
        <option value="">Magistrat : tous</option>
        <option value="__moi">Mes dossiers</option>
        {utilisateursEntraide().map((u) => <option key={u.windowsUsername} value={u.windowsUsername}>{u.displayName}</option>)}
      </select>
      <input className="ml-auto w-72 rounded-md border px-3 py-1 text-sm" placeholder="N° ESABORA, pays, autorité, service, personne…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entraide internationale</h1>
          <p className="text-xs text-gray-500">
            Registre partagé · {api.statut.enLigne ? `synchronisé ${api.statut.derniereSynchro ? `à ${new Date(api.statut.derniereSynchro).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : api.statut.erreur ? `hors ligne (${api.statut.erreur})` : 'chargement…'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => api.synchroniser()} title="Synchroniser maintenant"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" className="bg-[#2B5746] hover:bg-[#2B5746]/90" onClick={() => setCreation(true)}><Plus className="h-4 w-4 mr-1" />Nouvelle demande</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {[
          ['Échéances dépassées', kpi.retard, 'border-l-red-500 text-red-700'],
          ['À échéance sous 30 jours', kpi.proche, 'border-l-amber-500 text-amber-700'],
          ['À signer', kpi.signer, 'border-l-violet-500 text-violet-700'],
          ['Délais légaux en jeu', kpi.legal, 'border-l-blue-500 text-blue-700'],
          ['Sans échéance (doit rester à 0)', kpi.sansEcheance, kpi.sansEcheance ? 'border-l-orange-500 text-orange-700' : 'border-l-green-600 text-green-700'],
        ].map(([l, n, c]) => (
          <div key={l as string} className={`rounded-lg border border-l-4 bg-white px-3 py-2 ${c}`}>
            <div className="text-2xl font-extrabold leading-tight">{n as number}</div>
            <div className="text-[11px] text-gray-500">{l as string}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {Onglets.map(([id, l, n]) => (
          <button key={id} onClick={() => setOnglet(id)}
            className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${onglet === id ? 'border-[#2B5746] text-[#2B5746] font-semibold' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {l}{n ? <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-600">{n}</span> : null}
          </button>
        ))}
      </div>

      {onglet === 'registre' && (<>{Filtres}{tableau(registre)}</>)}

      {onglet === 'cloturees' && (<>{Filtres}{tableau(cloturees, true)}</>)}

      {onglet === 'signer' && (
        <div className="space-y-2">
          {!monSignataire?.signature && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Pour signer, renseignez d’abord votre bloc signature (onglet « Ma signature »).</p>
          )}
          {aSigner.length === 0 && <p className="text-sm text-gray-500">Aucun courrier en attente de signature.</p>}
          {aSigner
            .sort((a, b) => Number((b.d.magistrat || '').toLowerCase() === api.moi.toLowerCase()) - Number((a.d.magistrat || '').toLowerCase() === api.moi.toLowerCase()))
            .map((l) => {
              const doc = l.e.docEnAttente!;
              return (
                <div key={l.d.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-2.5">
                  <BadgeType type={l.d.type} />
                  <span className="font-mono text-xs">{l.d.refEsabora}</span>
                  <span className="text-sm">{DOC_LABELS[doc.doc]}{doc.langue === 'en' ? ' (EN)' : ''}</span>
                  <span className="text-xs text-gray-500">préparé le {dateFr(doc.depuis)} · {nomUtilisateur(l.d.magistrat) || 'magistrat non désigné'}</span>
                  <span className="text-xs text-gray-500 truncate max-w-[260px]">{l.d.objet}</span>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => telechargerCourrier(api, l.d, doc.doc, doc.langue || 'fr').catch((e) => showToast(e.message, 'error'))}>
                      <Download className="h-3.5 w-3.5 mr-1" />Aperçu
                    </Button>
                    <Button size="sm" className="bg-[#2B5746] hover:bg-[#2B5746]/90" disabled={!monSignataire?.signature}
                      onClick={() => executerAction({ api, demande: l.d, monSignataire, notifier: showToast }, { action: 'signer', libelle: '', doc: doc.doc })}>
                      <PenLine className="h-3.5 w-3.5 mr-1" />Valider et signer
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {onglet === 'relances' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Une seule relance par service pour toutes ses demandes en retard.</p>
          {relancesParService.length === 0 && <p className="text-sm text-gray-500">Aucun service en retard.</p>}
          {relancesParService.map(({ service, lignes: ls }) => {
            const mail = mailRelanceGroupee(service, ls.map((l) => l.d), monSignataire, jour);
            return (
              <div key={service.id} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold">{service.libelle} <span className="ml-1 rounded-full bg-red-50 px-2 text-xs text-red-700">{ls.length} en retard</span></h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={async () => { const ok = await copyPlainToClipboard(`Objet : ${mail.objet}\n\n${mail.corps}`); showToast(ok ? 'Mail copié' : 'Copie impossible', ok ? 'success' : 'error'); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" />Copier le mail
                    </Button>
                    <a className="inline-flex items-center rounded-md border px-3 text-xs hover:bg-gray-50" href={lienMailto(mail)}><Mail className="h-3.5 w-3.5 mr-1" />Outlook</a>
                    <Button size="sm" className="bg-[#2B5746] hover:bg-[#2B5746]/90"
                      onClick={async () => { for (const l of ls) await api.ajouterEvenement(l.d.id, { type: 'relance_enqueteurs_mail', date: jour }); showToast('Relance notée sur chaque dossier', 'success'); }}>
                      Noter la relance
                    </Button>
                  </div>
                </div>
                <ul className="text-sm divide-y">
                  {ls.map((l) => (
                    <li key={l.d.id} className="flex items-center gap-3 py-1 cursor-pointer hover:bg-gray-50" onClick={() => setFicheId(l.d.id)}>
                      <BadgeEcheance etat={l.e} /><span className="font-mono text-xs">{l.d.refEsabora}</span><span>{l.d.pays}</span>
                      <span className="text-gray-600 truncate">{l.d.objet}</span><span className="ml-auto text-xs text-gray-500">{l.e.nbRelances} relance(s)</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {etrangerEnRetard.length > 0 && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold mb-2">Demandes émises sans réponse à l’échéance ({etrangerEnRetard.length})</h3>
              <ul className="text-sm divide-y">
                {etrangerEnRetard.map((l) => (
                  <li key={l.d.id} className="flex items-center gap-3 py-1 cursor-pointer hover:bg-gray-50" onClick={() => setFicheId(l.d.id)}>
                    <BadgeEcheance etat={l.e} /><BadgeType type={l.d.type} /><span className="font-mono text-xs">{l.d.refEsabora}</span>
                    <span>{l.d.pays}</span><span className="text-gray-600 truncate">{l.d.autoriteNom || l.d.objet}</span>
                    <span className="ml-auto text-xs text-[#2B5746]">Représenter / relancer (T4) →</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {onglet === 'referentiels' && <ReferentielsPanel api={api} />}
      {onglet === 'signature' && <SignaturePanel api={api} />}

      {ficheId && <EntraideFiche api={api} demandeId={ficheId} onClose={() => setFicheId(null)} />}
      {creation && <NouvelleDemandeModal api={api} onClose={() => setCreation(false)} onCree={(id) => { setCreation(false); setOnglet('registre'); setFicheId(id); }} />}
    </div>
  );
};
