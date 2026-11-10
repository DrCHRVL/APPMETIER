'use client';

/**
 * Paramètres → Papeterie : en-têtes et signature des documents produits par
 * SIRAL (actes, courriers, SAS, clôture, trames Entraide, rapports PDF).
 *  - « Ma signature » : chacun règle la sienne ;
 *  - « Tribunal » : réservé à l'administrateur du TJ.
 * Un champ laissé vide reprend la valeur par défaut affichée en grisé.
 */
import React, { useMemo, useState } from 'react';
import { FileSignature, Landmark } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { UserManager } from '@/utils/userManager';
import {
  papeterieTjParDefaut, papeteriePersoParDefaut, type PapeterieTj, type PapeteriePerso,
} from '@/lib/web/papeterie';
import { estSuperAdmin, estTjOrigine, tjCourantNom } from '@/lib/web/identite';

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
  const { user, isAdmin, refreshUsers } = useUser();
  const { showToast } = useToast();
  const manager = UserManager.getInstance();
  const origine = estTjOrigine();
  const nomTj = tjCourantNom();
  const admin = isAdmin();

  const defTj = useMemo(() => papeterieTjParDefaut(nomTj, origine), [nomTj, origine]);
  const defPerso = useMemo(
    () => papeteriePersoParDefaut(user?.displayName || '', origine && estSuperAdmin()),
    [user?.displayName, origine],
  );

  const [tj, setTj] = useState<PapeterieTj>(() => manager.getConfig()?.papeterie || {});
  // saisie brute (retours à la ligne, virgules) : convertie à l'enregistrement
  const [adresseTxt, setAdresseTxt] = useState(() => (tj.adresse || []).join('\n'));
  const [mailsTxt, setMailsTxt] = useState(() => (tj.mailsService || []).join(', '));
  const [perso, setPerso] = useState<PapeteriePerso>(() => user?.papeterie || {});
  const [busy, setBusy] = useState(false);

  const texte = (v: string | undefined) => v || '';
  const lignes = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);

  const enregistrerPerso = async () => {
    setBusy(true);
    const ok = await manager.updateMyPapeterie(perso);
    setBusy(false);
    if (ok) { await refreshUsers(); showToast('Signature enregistrée', 'success'); }
    else showToast('Enregistrement impossible', 'error');
  };

  const enregistrerTj = async () => {
    setBusy(true);
    const ok = await manager.updatePapeterieTj({
      ...tj,
      adresse: lignes(adresseTxt),
      mailsService: mailsTxt.split(',').map((m) => m.trim()).filter(Boolean),
    });
    setBusy(false);
    if (ok) showToast('Papeterie du tribunal enregistrée', 'success');
    else showToast('Enregistrement impossible', 'error');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-xs text-gray-500 leading-relaxed">
        En-têtes et signature des documents produits par SIRAL : actes, courriers, SAS, clôtures, trames Entraide et
        rapports PDF. Un champ laissé vide reprend la valeur grisée.
      </p>

      <section className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-emerald-600" /> Ma signature
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Ligne label="NOM Prénom (« Nous, … »)" value={texte(perso.nomQualite)} placeholder={defPerso.nomQualite} onChange={(v) => setPerso({ ...perso, nomQualite: v })} />
          <Ligne label="Prénom NOM (signature)" value={texte(perso.prenomNom)} placeholder={defPerso.prenomNom} onChange={(v) => setPerso({ ...perso, prenomNom: v })} />
          <Ligne label="Qualité" value={texte(perso.qualite)} placeholder={defPerso.qualite} onChange={(v) => setPerso({ ...perso, qualite: v })} />
          <Ligne label="Mention sous la signature" value={texte(perso.fonctionCourte)} placeholder={defPerso.fonctionCourte} onChange={(v) => setPerso({ ...perso, fonctionCourte: v })} />
          <Ligne label="Section (en-tête des actes)" value={texte(perso.section)} placeholder={defPerso.section || 'ex. Section criminalité organisée'} onChange={(v) => setPerso({ ...perso, section: v })} />
          <Ligne label="Section détaillée (courriers)" value={texte(perso.sectionDetail)} placeholder={defPerso.sectionDetail || 'reprend la section'} onChange={(v) => setPerso({ ...perso, sectionDetail: v })} />
          <Ligne label="Compétences (pied de page)" value={texte(perso.thematiques)} placeholder={defPerso.thematiques || 'facultatif'} onChange={(v) => setPerso({ ...perso, thematiques: v })} />
          <Ligne label="Mail professionnel" value={texte(perso.mail)} placeholder={defPerso.mail || 'prenom.nom@justice.fr'} onChange={(v) => setPerso({ ...perso, mail: v })} />
        </div>
        <button className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50" onClick={enregistrerPerso} disabled={busy}>
          Enregistrer ma signature
        </button>
      </section>

      <section className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-emerald-600" /> Tribunal{nomTj ? ` — ${nomTj}` : ''}
        </h3>
        {!admin && <p className="text-xs text-gray-500">Réglée par l&apos;administrateur de votre tribunal.</p>}
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
          <button className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50" onClick={enregistrerTj} disabled={busy}>
            Enregistrer la papeterie du tribunal
          </button>
        )}
      </section>
    </div>
  );
};
