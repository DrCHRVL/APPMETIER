'use client';

// Section « ENTRAIDE » de la page Statistiques. Les chiffres viennent de
// lib/stats/entraideCore.mjs (source unique, partagée avec le connecteur) ;
// chaque carte affiche sa règle de calcul au survol.

import React, { useMemo, useSyncExternalStore } from 'react';
import { Info } from 'lucide-react';
import { computeEntraideStats } from '@/lib/stats/entraideCore.mjs';
import { entraideSyncService, ENTRAIDE_VIDE } from '@/utils/dataSync/EntraideSyncService';

interface Carte { id: string; titre: string; valeur: number | null; unite?: string; detail?: string; regle: string }
interface Stats {
  periode: { du: string; au: string };
  cartes: Carte[];
  delaisParType: Array<{ libelle: string; nombre: number; medianeJours: number | null }>;
  parService: Array<{ service: string; confies: number; enCours: number; enRetard: number; delaiMedianRetourJours: number | null }>;
  anciennete: Array<{ libelle: string; nombre: number }>;
  paysRecues: Array<{ pays: string; nombre: number }>;
  paysEmises: Array<{ pays: string; nombre: number }>;
  mensuel: Array<{ mois: string; entrees: number; cloturees: number }>;
}

const subscribe = (fn: () => void) => entraideSyncService.subscribe(fn);
const getData = () => entraideSyncService.getData();
const getServerData = () => ENTRAIDE_VIDE;

const valeur = (c: Carte) => (c.valeur === null || c.valeur === undefined ? '—' : `${c.valeur}${c.unite === '%' ? ' %' : c.unite ? ` ${c.unite}` : ''}`);

export const EntraideStats: React.FC<{ selectedYear: number }> = ({ selectedYear }) => {
  const data = useSyncExternalStore(subscribe, getData, getServerData);
  const s = useMemo(() => {
    const services = new Map(data.services.map((x) => [x.id, x.libelle]));
    return computeEntraideStats(data.demandes, selectedYear, new Date(),
      (id: string | undefined, autre: string | undefined) => (id && services.get(id)) || autre || 'Non renseigné') as Stats;
  }, [data.demandes, data.services, selectedYear]);

  if (!data.demandes.length) {
    return <p className="text-sm text-gray-500">Aucune demande d’entraide enregistrée.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {s.cartes.map((c) => (
          <div key={c.id} className="rounded-lg border bg-white p-3" title={c.regle}>
            <div className="flex items-start justify-between gap-2 text-xs text-gray-500">
              <span>{c.titre}</span><Info className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{valeur(c)}</div>
            {c.detail && <div className="mt-0.5 text-[11px] text-gray-500">{c.detail}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-white p-3">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Durée médiane de traitement (dossiers clôturés)</h4>
          <table className="w-full text-xs">
            <thead className="text-gray-500"><tr><th className="text-left font-normal">Type</th><th className="text-right font-normal">Clôturés</th><th className="text-right font-normal">Médiane</th></tr></thead>
            <tbody>{s.delaisParType.map((x) => (
              <tr key={x.libelle} className="border-t"><td className="py-1">{x.libelle}</td><td className="text-right tabular-nums">{x.nombre}</td><td className="text-right tabular-nums">{x.medianeJours ?? '—'} j</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Ancienneté des dossiers en cours (fin de période)</h4>
          <table className="w-full text-xs">
            <tbody>{s.anciennete.map((x) => (
              <tr key={x.libelle} className="border-t first:border-0"><td className="py-1">{x.libelle}</td><td className="text-right tabular-nums font-semibold">{x.nombre}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-3" title="Services saisis de demandes reçues : soit-transmis envoyés dans l'année, dossiers chez eux aujourd'hui, en retard aujourd'hui, délai médian de retour (retours reçus dans l'année).">
        <h4 className="text-xs font-semibold text-gray-700 mb-2">Services enquêteurs</h4>
        <table className="w-full text-xs">
          <thead className="text-gray-500"><tr><th className="text-left font-normal">Service</th><th className="text-right font-normal">ST envoyés</th><th className="text-right font-normal">En cours</th><th className="text-right font-normal">En retard</th><th className="text-right font-normal">Retour médian</th></tr></thead>
          <tbody>{s.parService.map((x) => (
            <tr key={x.service} className="border-t">
              <td className="py-1">{x.service}</td><td className="text-right tabular-nums">{x.confies}</td><td className="text-right tabular-nums">{x.enCours}</td>
              <td className={`text-right tabular-nums ${x.enRetard ? 'text-red-700 font-semibold' : ''}`}>{x.enRetard}</td>
              <td className="text-right tabular-nums">{x.delaiMedianRetourJours === null ? '—' : `${x.delaiMedianRetourJours} j`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {([['Pays — demandes reçues', s.paysRecues], ['Pays — demandes émises', s.paysEmises]] as const).map(([t, rows]) => (
          <div key={t} className="rounded-lg border bg-white p-3">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">{t}</h4>
            <table className="w-full text-xs"><tbody>{rows.map((x) => (
              <tr key={x.pays} className="border-t first:border-0"><td className="py-1">{x.pays}</td><td className="text-right tabular-nums">{x.nombre}</td></tr>
            ))}</tbody></table>
          </div>
        ))}
        <div className="rounded-lg border bg-white p-3">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Évolution mensuelle</h4>
          <table className="w-full text-xs">
            <thead className="text-gray-500"><tr><th className="text-left font-normal">Mois</th><th className="text-right font-normal">Entrées</th><th className="text-right font-normal">Clôtures</th></tr></thead>
            <tbody>{s.mensuel.map((x) => (
              <tr key={x.mois} className="border-t"><td className="py-0.5">{x.mois}</td><td className="text-right tabular-nums">{x.entrees}</td><td className="text-right tabular-nums">{x.cloturees}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
