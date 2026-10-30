'use client';

// Création d'une demande en un écran : sens, type, référence ESABORA,
// autorité (saisie apprise), mesures (proposées à la frappe), service saisi,
// magistrat. Tout le reste (étape, échéances) se déduira des clics suivants.

import React, { useMemo, useState } from 'react';
import { X, FileSearch, Loader2, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useToast } from '@/contexts/ToastContext';
import { aujourdhui, chercherAutorites, DRAPEAU_LABELS, normaliser, PAYS, paysDe, TYPE_LABELS } from '@/utils/entraide/logique';
import { lirePiece, personnesEnTexte, rattacherLecture, useLecturePieceDisponible, type LecturePiece } from '@/utils/entraide/lecturePiece';
import { LecturePieceVue } from './LecturePieceVue';
import { AutoriteSelect } from './AutoriteSelect';
import { NatinfChamp } from './NatinfChamp';
import { AutreUniteInput } from './AutreUniteInput';
import { MesuresInput } from './MesuresInput';
import { utilisateursEntraide } from './utilisateurs';
import { nouvelId, type EntraideApi } from '@/hooks/useEntraide';
import type { AutoriteEtrangere, EntraideDrapeau, EntraideSens, EntraideType } from '@/types/entraideTypes';

interface Props {
  api: EntraideApi;
  onClose: () => void;
  onCree: (id: string) => void;
}

const TYPES: EntraideType[] = ['dee', 'do', 'cri', 'execution', 'civil'];

// Hors du composant : défini dedans, il serait recréé à chaque frappe et les
// champs perdraient le focus.
const Champ: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className}>
    <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
    {children}
  </div>
);

export const NouvelleDemandeModal: React.FC<Props> = ({ api, onClose, onCree }) => {
  const { showToast } = useToast();
  useEscapeKey(onClose);
  const [sens, setSens] = useState<EntraideSens>('recue');
  const [type, setType] = useState<EntraideType>('dee');
  const [refEsabora, setRefEsabora] = useState('');
  const [refEtrangere, setRefEtrangere] = useState('');
  const [date, setDate] = useState(aujourdhui());
  const [pays, setPays] = useState('');
  const [autorite, setAutorite] = useState<AutoriteEtrangere | null>(null);
  const [requeteAutorite, setRequeteAutorite] = useState('');
  const [objet, setObjet] = useState('');
  const [personnes, setPersonnes] = useState('');
  const [mesures, setMesures] = useState<string[]>([]);
  const [natinf, setNatinf] = useState<string[]>([]);
  const [drapeau, setDrapeau] = useState<EntraideDrapeau | undefined>(undefined);
  const [serviceId, setServiceId] = useState('');
  const [serviceAutre, setServiceAutre] = useState('');
  const [magistrat, setMagistrat] = useState(api.moi);
  const [echeanceLegale, setEcheanceLegale] = useState({ date: '', libelle: '' });
  const lecturePossible = useLecturePieceDisponible();
  const [lecture, setLecture] = useState<LecturePiece | null>(null);
  const [enLecture, setEnLecture] = useState(false);

  /** Préremplit les champs encore vides d'après la lecture de la pièce. */
  const appliquerLecture = (l: LecturePiece) => {
    if (l.sens) setSens(l.sens);
    if (l.type) setType(l.type);
    const p = l.pays || l.autorite.pays;
    if (p && !pays && !autorite) setPays(p);
    if (l.autorite.reference && !refEtrangere) setRefEtrangere(l.autorite.reference);
    if (!objet) setObjet([l.infractions, l.lieux[0]?.ville].filter(Boolean).join(' – '));
    if (!personnes && l.personnes.length) setPersonnes(personnesEnTexte(l));
    if (l.mesures.length) setMesures((m) => Array.from(new Set([...m, ...l.mesures])));
    if (l.dateButoir && !echeanceLegale.date) setEcheanceLegale({ date: l.dateButoir, libelle: 'Date butoir fixée par l’autorité requérante' });
    if (!autorite && l.autorite.nom) {
      const requete = [l.autorite.ville, l.autorite.nom].filter(Boolean).join(' ');
      const trouvee = chercherAutorites(api.data.autorites, l.autorite.ville || l.autorite.nom, p)
        .find((a) => normaliser(a.nom) === normaliser(l.autorite.nom) || (!!l.autorite.ville && normaliser(a.ville) === normaliser(l.autorite.ville)));
      if (trouvee) { setAutorite(trouvee); setRequeteAutorite(requete); setPays(trouvee.pays); }
    }
  };

  const lire = async (fichier: File) => {
    setEnLecture(true);
    try {
      const { analyse } = await lirePiece(fichier);
      setLecture(analyse);
      appliquerLecture(analyse);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lecture impossible', 'error');
    } finally {
      setEnLecture(false);
    }
  };

  const utilisateurs = useMemo(() => utilisateursEntraide(), []);
  const frequences = useMemo(() => {
    const f: Record<string, number> = {};
    for (const d of api.data.demandes) for (const m of d.mesures || []) f[m] = (f[m] || 0) + 1;
    return f;
  }, [api.data.demandes]);
  const services = api.data.services.filter((s) => !s.inactif);

  const valider = async () => {
    if (!refEsabora.trim()) { showToast('Le numéro ESABORA (N/réf) est requis', 'warning'); return; }
    const p = autorite?.pays || pays;
    if (!p) { showToast('Le pays est requis', 'warning'); return; }
    const id = await api.creerDemande({
      type, sens,
      refEsabora: refEsabora.trim(),
      refEtrangere: refEtrangere.trim() || undefined,
      pays: p,
      autoriteId: autorite?.id,
      autoriteNom: autorite?.nom,
      objet: objet.trim(),
      personnes: personnes.trim() || undefined,
      mesures,
      natinf: natinf.length ? natinf : undefined,
      drapeau,
      serviceId: sens === 'recue' && serviceId !== '__autre' ? serviceId || undefined : undefined,
      serviceAutre: sens === 'recue' && serviceId === '__autre' ? serviceAutre.trim() : undefined,
      magistrat: magistrat || undefined,
      dateEnregistrement: date,
      echeancesLegales: echeanceLegale.date ? [{ id: nouvelId('l'), date: echeanceLegale.date, libelle: echeanceLegale.libelle || 'Échéance légale' }] : undefined,
    });
    if (autorite && requeteAutorite) api.apprendreAutorite(autorite.id, requeteAutorite);
    if (lecture) rattacherLecture(id, lecture);
    showToast('Demande créée', 'success');
    onCree(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[92vw] max-w-[720px] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">Nouvelle demande d'entraide</h2>
          <div className="flex items-center gap-1">
            {lecturePossible && (
              <label className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm cursor-pointer hover:bg-gray-50 ${enLecture ? 'opacity-60 pointer-events-none' : ''}`}
                title="Préremplir à partir de la demande reçue (PDF, scan, ODT, DOCX)">
                {enLecture ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                {enLecture ? 'Lecture…' : 'Lire une pièce'}
                <input type="file" className="hidden" accept=".pdf,.odt,.docx,.doc,.rtf,.txt"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) lire(f); }} />
              </label>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="h-5 w-5 text-gray-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {lecture && (
            <div className="rounded-lg border border-[#2B5746]/25 bg-[#2B5746]/5 p-3">
              <LecturePieceVue l={lecture} compact />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(['recue', 'emise'] as EntraideSens[]).map((s) => (
              <button key={s} type="button" onClick={() => setSens(s)}
                className={`px-3 py-1 rounded-full text-sm border ${sens === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700'}`}>
                {s === 'recue' ? '← Reçue de l’étranger' : 'Émise par la France →'}
              </button>
            ))}
            <span className="w-3" />
            {TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`px-3 py-1 rounded-full text-sm border ${type === t ? 'bg-[#2B5746] text-white border-[#2B5746]' : 'bg-white text-gray-700'}`}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Champ label="N/réf (n° ESABORA)">
              <input className="w-full rounded-md border px-3 py-1.5 text-sm font-mono" placeholder="B3221-2026/00301" value={refEsabora} onChange={(e) => setRefEsabora(e.target.value)} autoFocus />
            </Champ>
            <Champ label={sens === 'recue' ? 'Date de réception' : "Date d'enregistrement"}>
              <input type="date" className="w-full rounded-md border px-3 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
            </Champ>
            <Champ label="V/réf (autorité étrangère)">
              <input className="w-full rounded-md border px-3 py-1.5 text-sm" value={refEtrangere} onChange={(e) => setRefEtrangere(e.target.value)} />
            </Champ>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Champ label="Pays">
              <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={autorite?.pays || pays} onChange={(e) => setPays(e.target.value)} disabled={!!autorite}>
                <option value="">—</option>
                {PAYS.map((p) => <option key={p.nom} value={p.nom}>{p.nom}{p.ue ? '' : ' (hors UE)'}</option>)}
              </select>
            </Champ>
            <Champ label={sens === 'recue' ? 'Autorité requérante' : 'Autorité destinataire'} className="col-span-2">
              <AutoriteSelect
                autorites={api.data.autorites}
                pays={pays}
                valeur={autorite}
                onChoisir={(a, q) => { setAutorite(a); setRequeteAutorite(q); if (a) setPays(a.pays); }}
                onCreer={(a) => api.enregistrerAutorite(a)}
                suggestion={lecture?.autorite.nom ? { nom: lecture.autorite.nom, ville: lecture.autorite.ville, pays: lecture.autorite.pays || lecture.pays } : null}
              />
            </Champ>
          </div>
          {type === 'dee' && pays && paysDe(pays) && !paysDe(pays)!.ue && (
            <p className="text-xs text-amber-800">Une DEE ne concerne que les États membres de l’Union : pour ce pays, choisissez plutôt CRI.</p>
          )}

          <Champ label="Objet">
            <input className="w-full rounded-md border px-3 py-1.5 text-sm" placeholder="Ex. délit de fuite – audition d'un témoin" value={objet} onChange={(e) => setObjet(e.target.value)} />
          </Champ>
          <Champ label="Infraction (NATINF — équivalent en droit français)">
            <NatinfChamp valeur={natinf} onChange={setNatinf} />
          </Champ>
          <Champ label="Personne(s) visée(s) ou victime(s)">
            <input className="w-full rounded-md border px-3 py-1.5 text-sm" placeholder="Ex. M. Paul X., né le 01/01/1980, demeurant …" value={personnes} onChange={(e) => setPersonnes(e.target.value)} />
          </Champ>
          <Champ label="Mesures demandées">
            <MesuresInput valeur={mesures} onChange={setMesures} frequences={frequences} />
          </Champ>

          <div className="grid grid-cols-2 gap-3">
            {sens === 'recue' && (
              <Champ label="Service enquêteur saisi">
                <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  <option value="">À choisir plus tard</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}
                  <option value="__autre">Autre unité…</option>
                </select>
                {serviceId === '__autre' && (
                  <AutreUniteInput className="mt-1.5 w-full rounded-md border px-3 py-1.5 text-sm" demandes={api.data.demandes} valeur={serviceAutre} onChange={setServiceAutre} />
                )}
              </Champ>
            )}
            <Champ label="Magistrat en charge">
              <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={magistrat} onChange={(e) => setMagistrat(e.target.value)}>
                <option value="">—</option>
                {utilisateurs.map((u) => <option key={u.windowsUsername} value={u.windowsUsername}>{u.displayName}</option>)}
              </select>
            </Champ>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Drapeau :</span>
            {(['orange', 'rouge'] as EntraideDrapeau[]).map((c) => (
              <button key={c} type="button" onClick={() => setDrapeau(drapeau === c ? undefined : c)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${drapeau === c ? (c === 'rouge' ? 'bg-red-100 border-red-300 text-red-800' : 'bg-orange-100 border-orange-300 text-orange-800') : 'bg-white text-gray-700'}`}>
                <Flag className={`h-3 w-3 ${c === 'rouge' ? 'text-red-600' : 'text-orange-500'} ${drapeau === c ? 'fill-current' : ''}`} />{DRAPEAU_LABELS[c]}
              </button>
            ))}
            <span className="text-[11px] text-gray-500">délais de retour raccourcis, pré-alerte plus tôt</span>
          </div>

          <details className="rounded-md border border-gray-200 px-3 py-2">
            <summary className="text-xs font-medium text-gray-600 cursor-pointer">Échéance légale particulière (prescription, date butoir fixée par l’État…)</summary>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input type="date" className="rounded-md border px-2 py-1 text-sm" value={echeanceLegale.date} onChange={(e) => setEcheanceLegale({ ...echeanceLegale, date: e.target.value })} />
              <input className="col-span-2 rounded-md border px-2 py-1 text-sm" placeholder="Ex. Prescription de la peine" value={echeanceLegale.libelle} onChange={(e) => setEcheanceLegale({ ...echeanceLegale, libelle: e.target.value })} />
            </div>
          </details>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={valider} className="bg-[#2B5746] hover:bg-[#2B5746]/90">Créer la demande</Button>
        </div>
      </div>
    </div>
  );
};
