'use client';

/**
 * Paramètres → En-têtes des documents (administrateur du TJ).
 * Ce qui s'imprime en haut et en bas des documents produits par SIRAL dans ce
 * tribunal : surtout les courriers de l'Entraide et l'export des statistiques.
 * Un champ laissé vide reprend la valeur grisée.
 */
import React, { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { UserManager } from '@/utils/userManager';
import { papeterieTjParDefaut, type PapeterieTj } from '@/lib/web/papeterie';
import { estTjOrigine, tjCourantNom } from '@/lib/web/identite';

const champ = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm';

const Ligne: React.FC<{ label: string; value: string; placeholder: string; onChange: (v: string) => void; disabled?: boolean; multiline?: boolean }> =
  ({ label, value, placeholder, onChange, disabled, multiline }) => (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {multiline ? (
        <textarea className={champ} rows={4} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={champ} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );

export const PapeterieSettings: React.FC = () => {
  const { isAdmin } = useUser();
  const { showToast } = useToast();
  const manager = UserManager.getInstance();
  const nomTj = tjCourantNom();
  const admin = isAdmin();

  const defTj = useMemo(() => papeterieTjParDefaut(nomTj, estTjOrigine()), [nomTj]);
  const [tj, setTj] = useState<PapeterieTj>(() => manager.getConfig()?.papeterie || {});
  // saisie brute (retours à la ligne, virgules) : convertie à l'enregistrement
  const [adresseTxt, setAdresseTxt] = useState(() => (tj.adresse || []).join('\n'));
  const [mailsTxt, setMailsTxt] = useState(() => (tj.mailsService || []).join(', '));
  const [busy, setBusy] = useState(false);

  const texte = (v: string | undefined) => v || '';
  const lignes = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
  const val = (v: string | undefined, d: string) => (v && v.trim()) || d;
  const adresse = lignes(adresseTxt).length ? lignes(adresseTxt) : defTj.adresse;

  const enregistrer = async () => {
    setBusy(true);
    const ok = await manager.updatePapeterieTj({
      ...tj,
      adresse: lignes(adresseTxt),
      mailsService: mailsTxt.split(',').map((m) => m.trim()).filter(Boolean),
    });
    setBusy(false);
    if (ok) showToast('En-têtes du tribunal enregistrés', 'success');
    else showToast('Enregistrement impossible', 'error');
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-xs text-gray-600 leading-relaxed">
        Ce qui s&apos;imprime <b>en haut et en bas</b> des documents que SIRAL produit dans ce tribunal : essentiellement
        les <b>courriers de l&apos;Entraide</b> (soit-transmis, retours et relances aux autorités étrangères) et l&apos;<b>export
        PDF des statistiques</b>. Un champ vide reprend la valeur grisée.
      </p>

      {/* Aperçu : ce que verra le destinataire */}
      <div className="border border-gray-200 rounded-lg p-4 bg-white text-[12px] leading-snug text-gray-800">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Aperçu</div>
        <div className="font-semibold">{val(tj.juridiction, defTj.juridiction)}</div>
        <div>{val(tj.parquet, defTj.parquet)}</div>
        <div className="my-3 text-gray-400 italic">… corps du document …</div>
        <div>Fait à {val(tj.ville, defTj.ville)}, le …</div>
        <div className="mt-3 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
          {adresse.join(' · ')}{val(tj.standard, defTj.standard) ? ` · ${val(tj.standard, defTj.standard)}` : ''}
        </div>
      </div>

      <section className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-emerald-600" /> {nomTj || 'Tribunal'}
        </h3>
        {!admin && <p className="text-xs text-gray-500">Réglés par l&apos;administrateur de votre tribunal.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Ligne label="En-tête (« Cour d'appel de X — Tribunal judiciaire de Y »)" value={texte(tj.juridiction)} placeholder={defTj.juridiction} disabled={!admin} onChange={(v) => setTj({ ...tj, juridiction: v })} />
          <Ligne label="Parquet" value={texte(tj.parquet)} placeholder={defTj.parquet} disabled={!admin} onChange={(v) => setTj({ ...tj, parquet: v })} />
          <Ligne label="Ville (« Fait à … »)" value={texte(tj.ville)} placeholder={defTj.ville} disabled={!admin} onChange={(v) => setTj({ ...tj, ville: v })} />
          <Ligne label="Ressort (« près le tribunal judiciaire de … »)" value={texte(tj.ressort)} placeholder={defTj.ressort} disabled={!admin} onChange={(v) => setTj({ ...tj, ressort: v })} />
          <Ligne label="Adresse (une ligne par ligne)" multiline value={adresseTxt} placeholder={defTj.adresse.join('\n')} disabled={!admin} onChange={setAdresseTxt} />
          <div className="space-y-3">
            <Ligne label="Standard" value={texte(tj.standard)} placeholder={defTj.standard || '03 00 00 00 00'} disabled={!admin} onChange={(v) => setTj({ ...tj, standard: v })} />
            <Ligne label="Mail du service" value={mailsTxt} placeholder={defTj.mailsService.join(', ') || 'service@justice.fr'} disabled={!admin} onChange={setMailsTxt} />
          </div>
        </div>
        {admin && (
          <button className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50" onClick={enregistrer} disabled={busy}>
            Enregistrer
          </button>
        )}
      </section>
    </div>
  );
};
