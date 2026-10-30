'use client';

// Listes de référence du module : autorités étrangères (apprises à l'usage,
// avec leurs mots-clés) et services enquêteurs (cases des trames T1/T2).

import React, { useMemo, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { chercherAutorites, PAYS } from '@/utils/entraide/logique';
import type { EntraideApi } from '@/hooks/useEntraide';
import type { AutoriteEtrangere, AutoriteNature, EntraideLangue, ServiceEnqueteur } from '@/types/entraideTypes';

const CASES_LIBELLES: Array<[string, string]> = [
  ['comm_amiens', "Commissariat d'Amiens"], ['comm_abbeville', "Commissariat d'Abbeville"], ['cgd', 'Compagnie de gendarmerie'],
  ['cgd_abbeville', 'Abbeville'], ['cgd_amiens', 'Amiens'], ['cgd_montdidier', 'Montdidier'], ['cgd_peronne', 'Péronne'],
  ['autre', 'Autre unité (libellé imprimé)'],
];

const ATLAS_EJN = 'https://ejn-crimjust.europa.eu/ejn2021/AtlasChooseCountry/EN';
const FICHES_BELGES = 'https://ejn-crimjust.europa.eu/ejn2021/FichesBelges/EN';

const FicheAutorite: React.FC<{ a: AutoriteEtrangere; api: EntraideApi }> = ({ a, api }) => {
  const [f, setF] = useState(a);
  const [conf, setConf] = useState(false);
  const champ = 'rounded border px-2 py-1 text-xs';
  const modifie = JSON.stringify(f) !== JSON.stringify(a);
  return (
    <tr className="border-t align-top">
      <td className="p-1.5"><input className={`${champ} w-full`} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></td>
      <td className="p-1.5">
        <select className={champ} value={f.nature || 'autre'} onChange={(e) => setF({ ...f, nature: e.target.value as AutoriteNature })}>
          {['parquet', 'tribunal', 'juge', 'ministere', 'police', 'autre'].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </td>
      <td className="p-1.5"><input className={`${champ} w-28`} value={f.ville || ''} onChange={(e) => setF({ ...f, ville: e.target.value })} /></td>
      <td className="p-1.5"><textarea className={`${champ} w-44`} rows={1} value={f.adresse || ''} onChange={(e) => setF({ ...f, adresse: e.target.value })} /></td>
      <td className="p-1.5">
        <select className={champ} value={f.pays} onChange={(e) => setF({ ...f, pays: e.target.value })}>
          {!PAYS.some((p) => p.nom === f.pays) && <option value={f.pays}>{f.pays}</option>}
          {PAYS.map((p) => <option key={p.nom} value={p.nom}>{p.nom}</option>)}
        </select>
      </td>
      <td className="p-1.5">
        <select className={champ} value={f.langue} onChange={(e) => setF({ ...f, langue: e.target.value as EntraideLangue })}>
          <option value="fr">FR</option><option value="en">EN</option>
        </select>
      </td>
      <td className="p-1.5"><input className={`${champ} w-40`} value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></td>
      <td className="p-1.5"><input className={`${champ} w-40`} value={f.motsCles.join(', ')} onChange={(e) => setF({ ...f, motsCles: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></td>
      <td className="p-1.5 whitespace-nowrap">
        {modifie && <button className="rounded bg-[#2B5746] px-2 py-1 text-xs text-white mr-1" onClick={() => api.enregistrerAutorite(f)}>Enregistrer</button>}
        {conf
          ? <button className="text-xs text-red-700" onClick={() => api.supprimerAutorite(a.id)}>Confirmer</button>
          : <button title="Supprimer" onClick={() => setConf(true)}><Trash2 className="h-3.5 w-3.5 text-gray-400" /></button>}
      </td>
    </tr>
  );
};

const FicheService: React.FC<{ s: ServiceEnqueteur; api: EntraideApi }> = ({ s, api }) => {
  const [f, setF] = useState(s);
  const modifie = JSON.stringify(f) !== JSON.stringify(s);
  return (
    <tr className="border-t align-top">
      <td className="p-1.5"><input className="w-full rounded border px-2 py-1 text-xs" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></td>
      <td className="p-1.5"><input className="w-48 rounded border px-2 py-1 text-xs" value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="mail du service" /></td>
      <td className="p-1.5 text-[11px]">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {CASES_LIBELLES.map(([c, l]) => (
            <label key={c} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={f.cases.includes(c)} onChange={(e) => setF({ ...f, cases: e.target.checked ? [...f.cases, c] : f.cases.filter((x) => x !== c) })} />{l}
            </label>
          ))}
        </div>
      </td>
      <td className="p-1.5"><label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={!!f.inactif} onChange={(e) => setF({ ...f, inactif: e.target.checked })} />retiré</label></td>
      <td className="p-1.5">{modifie && <button className="rounded bg-[#2B5746] px-2 py-1 text-xs text-white" onClick={() => api.enregistrerService(f)}>Enregistrer</button>}</td>
    </tr>
  );
};

export const ReferentielsPanel: React.FC<{ api: EntraideApi }> = ({ api }) => {
  const [q, setQ] = useState('');
  const autorites = useMemo(
    () => (q.trim() ? chercherAutorites(api.data.autorites, q) : [...api.data.autorites].sort((a, b) => a.pays.localeCompare(b.pays) || a.nom.localeCompare(b.nom))),
    [api.data.autorites, q],
  );
  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold">Autorités étrangères ({api.data.autorites.length})</h3>
          <div className="flex items-center gap-2">
            <input className="rounded-md border px-3 py-1 text-sm w-64" placeholder="Rechercher (nom, ville, mot-clé)…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
              onClick={() => api.enregistrerAutorite({ nom: q || 'Nouvelle autorité', nature: 'parquet', pays: '', langue: 'en', motsCles: [] })}>+ Ajouter</button>
            <a className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs hover:bg-gray-50" href={ATLAS_EJN} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Atlas EJN</a>
            <a className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs hover:bg-gray-50" href={FICHES_BELGES} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Fiches belges</a>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-2">Les mots-clés s’apprennent seuls : ce que vous tapez pour retrouver une autorité lui est rattaché. La langue fixe celle des courriers T3/T4 et des mails (parquets flamands : anglais).</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500"><tr><th className="p-1.5">Nom</th><th>Nature</th><th>Ville</th><th>Adresse</th><th>Pays</th><th>Langue</th><th>Mail</th><th>Mots-clés</th><th /></tr></thead>
            <tbody>{autorites.map((a) => <FicheAutorite key={`${a.id}:${a.dateMiseAJour}`} a={a} api={api} />)}</tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Services enquêteurs</h3>
          <button className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
            onClick={() => api.enregistrerService({ id: `s${Date.now().toString(36)}`, libelle: 'Nouvelle unité', cases: ['autre'] })}>+ Ajouter une unité</button>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="text-gray-500"><tr><th className="p-1.5">Libellé</th><th>Mail</th><th>Cases cochées sur T1/T2</th><th /><th /></tr></thead>
          <tbody>{api.data.services.map((s) => <FicheService key={`${s.id}:${s.dateMiseAJour}`} s={s} api={api} />)}</tbody>
        </table>
      </section>
    </div>
  );
};
