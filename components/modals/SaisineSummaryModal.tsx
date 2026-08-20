import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Enquete } from '@/types/interfaces';
import { AlertTriangle, Check, Copy, FileDown, FileText, Pencil, RotateCcw } from 'lucide-react';
import { SiralBridge } from '@/utils/siralBridge';
import { copyPlainToClipboard } from '@/utils/richTextExport';
import { APP_CONFIG } from '@/config/constants';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { formatDateLong } from '@/utils/clotureDocument';
import { downloadActeDocx, downloadActePdf } from '@/lib/web/acteExport';
import {
  DEFAULT_SAISINE_TEMPLATE,
  SaisineDossierData,
  SaisineTemplate,
  buildSaisineText,
  destinatairesParDefaut,
  mergeSaisineTemplate,
  preventionsBlocs,
  visaParDefaut,
} from '@/utils/saisineDocument';
import {
  FAMILLES,
  Famille,
  InfractionSaisine,
  Regime706,
  famillePrincipale,
  qualificationPour,
  quantumEnLettres,
  regimePropose,
  seuilDonneesConnexionAtteint,
  viseBandeOrganisee,
} from '@/utils/saisine/familles';
import {
  MOTIFS_PAR_FAMILLE,
  buildMotivation,
  motifsDisponibles,
  motifsParDefaut,
} from '@/utils/saisine/motivations';
import {
  DEFAULT_SIGNATURE,
  SignatureElectronique,
  lireCachet,
  loadSignature,
  saveSignature,
  signatureActive,
} from '@/utils/signatureElectronique';

interface SaisineSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
}

/** Champ éditable de la trame de rédaction. */
type TemplateField = { key: keyof SaisineTemplate; label: string; multiline?: boolean };

const FIELD_GROUPS: { title: string; fields: TemplateField[] }[] = [
  {
    title: 'En-tête',
    fields: [
      { key: 'enteteJuridiction', label: 'Juridiction' },
      { key: 'enteteParquet', label: 'Parquet' },
      { key: 'enteteService', label: 'Section' },
      { key: 'enteteTelephone', label: 'Téléphone (facultatif)' },
      { key: 'titre', label: "Titre de l'acte" },
    ],
  },
  {
    title: 'Formules de saisine',
    fields: [
      { key: 'formuleSaisine', label: 'Saisine simple', multiline: true },
      { key: 'formuleSaisineCoSaisine', label: 'Co-saisine', multiline: true },
      { key: 'formuleActes', label: 'Formule des actes', multiline: true },
      {
        key: 'formuleActesApresAttendus',
        label: 'Formule des actes après attendus de bande organisée',
        multiline: true,
      },
    ],
  },
  {
    title: 'Autorisations permanentes',
    fields: [
      { key: 'autorisationRequisitions', label: 'Réquisitions (77-1, 77-1-1)', multiline: true },
      { key: 'autorisationLogiciels', label: 'Logiciels de rapprochement (230-20)', multiline: true },
      { key: 'autorisationEchanges', label: 'Échanges avec les pays partenaires', multiline: true },
    ],
  },
  {
    title: 'Rappels et clauses',
    fields: [
      { key: 'rappelTransport', label: 'Transport sur le territoire (18 al. 3)', multiline: true },
      { key: 'clause706Applicable', label: '706-80 applicable', multiline: true },
      { key: 'clause706SaufGav', label: '706-80 sauf garde à vue', multiline: true },
      { key: 'clause706NonApplicable', label: '706-80 non applicable', multiline: true },
    ],
  },
  {
    title: 'Diligences, suivi et signature',
    fields: [
      { key: 'formuleDiligences', label: 'Introduction des diligences', multiline: true },
      { key: 'formuleSuivi', label: 'Suivi direct', multiline: true },
      { key: 'formuleSuiviParSection', label: 'Suivi par la section CO', multiline: true },
      { key: 'lieu', label: 'Lieu' },
      { key: 'signataire', label: 'Signataire' },
    ],
  },
];

/** Découpe une saisie multi-lignes en entrées non vides. */
const lignes = (s: string): string[] =>
  s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Découpe une saisie en blocs séparés par une ligne vide (préventions). */
const blocs = (s: string): string[] =>
  s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

const REGIME_LABELS: Record<Regime706, string> = {
  derogatoire: '706-80 applicable',
  derogatoire_sauf_gav: '706-80 applicable sauf durée de garde à vue',
  droit_commun: 'Droit commun (706-80 non applicable)',
};

export const SaisineSummaryModal = ({ isOpen, onClose, enquete }: SaisineSummaryModalProps) => {
  const { infractionsForEnquete } = useInfractionNatinf();

  const [template, setTemplate] = useState<SaisineTemplate>(DEFAULT_SAISINE_TEMPLATE);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SaisineTemplate | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null);

  // ── Données du dossier, préremplies puis corrigées par le magistrat ──
  const [destinatairesTxt, setDestinatairesTxt] = useState('');
  const [coSaisine, setCoSaisine] = useState(false);
  const [visasTxt, setVisasTxt] = useState('');
  const [preventionsTxt, setPreventionsTxt] = useState('');
  const [commis, setCommis] = useState('');
  const [bandeOrganisee, setBandeOrganisee] = useState(false);
  const [attendusBO, setAttendusBO] = useState('');
  const [familleId, setFamilleId] = useState<string>('');
  const [quantum, setQuantum] = useState('');
  const [motifsCoches, setMotifsCoches] = useState<string[]>([]);
  const [motivationManuelle, setMotivationManuelle] = useState<string | null>(null);
  const [autorisationsTxt, setAutorisationsTxt] = useState('');
  const [extractionDetenu, setExtractionDetenu] = useState('');
  const [regime, setRegime] = useState<Regime706>('droit_commun');
  const [mentionner706, setMentionner706] = useState(false);
  const [diligencesTxt, setDiligencesTxt] = useState('');
  const [echeance, setEcheance] = useState('');
  const [suiviParSection, setSuiviParSection] = useState(false);
  const [signature, setSignature] = useState<SignatureElectronique>(DEFAULT_SIGNATURE);
  const [signatureErreur, setSignatureErreur] = useState('');

  // Infractions du dossier, réduites à ce dont le rattachement a besoin.
  const infractions = useMemo<InfractionSaisine[]>(
    () =>
      infractionsForEnquete(enquete).map((i) => ({
        label: i.label,
        code: i.code,
        articlesDefinition: i.entry?.articlesDefinition,
        articlesRepression: i.entry?.articlesRepression,
        emprisonnementMois: i.entry?.quantum?.emprisonnementMois,
        reclusionAnnees: i.entry?.quantum?.reclusionAnnees,
      })),
    [infractionsForEnquete, enquete],
  );

  const famille = useMemo<Famille | undefined>(
    () => FAMILLES.find((f) => f.id === familleId),
    [familleId],
  );

  // Préremplissage à l'ouverture : tout ce qui se déduit du dossier est posé,
  // le magistrat n'a plus qu'à corriger et compléter.
  useEffect(() => {
    if (!isOpen) return;

    SiralBridge.getData<Partial<SaisineTemplate>>(
      APP_CONFIG.STORAGE_KEYS.SAISINE_TEMPLATE,
      DEFAULT_SAISINE_TEMPLATE,
    ).then((saved) => {
      setTemplate(mergeSaisineTemplate(saved));
      setTemplateLoaded(true);
    });
    loadSignature().then(setSignature);

    const infs: InfractionSaisine[] = infractionsForEnquete(enquete).map((i) => ({
      label: i.label,
      code: i.code,
      articlesDefinition: i.entry?.articlesDefinition,
      articlesRepression: i.entry?.articlesRepression,
      emprisonnementMois: i.entry?.quantum?.emprisonnementMois,
      reclusionAnnees: i.entry?.quantum?.reclusionAnnees,
    }));
    const bo = viseBandeOrganisee(infs);
    const f = famillePrincipale(infs);

    setDestinatairesTxt(destinatairesParDefaut(enquete).join('\n'));
    setCoSaisine(false);
    setVisasTxt(visaParDefaut(enquete));
    setPreventionsTxt(preventionsBlocs(infs).join('\n\n'));
    setCommis('');
    setBandeOrganisee(bo);
    setAttendusBO('');
    setFamilleId(f?.id || '');
    setQuantum(quantumEnLettres(infs) || '');
    setMotifsCoches(motifsParDefaut(f?.id));
    setMotivationManuelle(null);
    setAutorisationsTxt('');
    setExtractionDetenu('');
    setRegime(regimePropose(f, bo));
    setMentionner706(false);
    setDiligencesTxt('');
    setEcheance('');
    setSuiviParSection(false);
    setSignatureErreur('');
    setCopied(false);
    setEditingTemplate(null);
  }, [isOpen, enquete, infractionsForEnquete]);

  // Changer de famille remet les circonstances proposées et le régime à leur
  // valeur pour cette famille : on ne garde pas les cases d'une autre matière.
  const changerFamille = useCallback(
    (id: string) => {
      setFamilleId(id);
      const f = FAMILLES.find((x) => x.id === id);
      setMotifsCoches(motifsParDefaut(f?.id));
      setRegime(regimePropose(f, bandeOrganisee));
      setMotivationManuelle(null);
    },
    [bandeOrganisee],
  );

  const changerBandeOrganisee = useCallback(
    (val: boolean) => {
      setBandeOrganisee(val);
      setRegime(regimePropose(famille, val));
      setMotivationManuelle(null);
    },
    [famille],
  );

  const motifs = useMemo(() => motifsDisponibles(famille?.id), [famille]);

  const motivationProposee = useMemo(
    () =>
      buildMotivation({
        qualification: qualificationPour(famille, bandeOrganisee),
        quantum,
        circonstances: motifs.filter((m) => motifsCoches.includes(m.id)).map((m) => m.texte),
        complement: famille ? MOTIFS_PAR_FAMILLE[famille.id]?.complement : undefined,
      }),
    [famille, bandeOrganisee, quantum, motifs, motifsCoches],
  );

  const motivation = motivationManuelle ?? motivationProposee;

  const dossier = useMemo<SaisineDossierData>(
    () => ({
      destinataires: lignes(destinatairesTxt),
      coSaisine,
      visas: lignes(visasTxt),
      preventions: blocs(preventionsTxt),
      commis,
      attendusBandeOrganisee: attendusBO,
      autorisationsLibres: lignes(autorisationsTxt),
      motivationDonnees: motivation,
      extractionDetenu,
      regime706: regime,
      mentionner706Inapplicable: mentionner706,
      diligences: lignes(diligencesTxt),
      echeance,
      suiviParSection,
    }),
    [
      destinatairesTxt, coSaisine, visasTxt, preventionsTxt, commis, attendusBO,
      autorisationsTxt, motivation, extractionDetenu, regime, mentionner706,
      diligencesTxt, echeance, suiviParSection,
    ],
  );

  const texte = useMemo(
    () => (templateLoaded ? buildSaisineText(template, dossier) : ''),
    [template, dossier, templateLoaded],
  );

  // ── Contrôles affichés avant génération ──
  const seuilAtteint = useMemo(() => seuilDonneesConnexionAtteint(infractions), [infractions]);
  const avertissements = useMemo(() => {
    const out: string[] = [];
    if (!infractions.length) {
      out.push(
        "Aucune infraction NATINF n'est renseignée dans l'enquête : les chefs de "
        + 'poursuite doivent être saisis à la main.',
      );
    }
    if (!quantum.trim()) {
      out.push(
        "Le référentiel ne renseigne pas la peine encourue pour ces infractions : "
        + "complétez le quantum, sans quoi l'acte portera « [quantum à compléter] ».",
      );
    } else if (seuilAtteint === false) {
      out.push(
        "La peine encourue est inférieure à trois ans d'emprisonnement : "
        + "l'accès aux données de trafic et de localisation de l'article 60-1-2 du "
        + 'code de procédure pénale ne paraît pas ouvert sur ce fondement.',
      );
    }
    if (!famille) {
      out.push(
        "Aucune famille de contentieux n'a été reconnue : choisissez-en une pour "
        + 'obtenir une motivation de criminalité grave, ou rédigez-la librement.',
      );
    }
    return out;
  }, [infractions, quantum, seuilAtteint, famille]);

  const acte = useMemo(
    () => ({
      titre: template.titre,
      contenu: texte,
      numero: enquete.numero,
      source: 'ST de saisine',
      type: 'soit_transmis',
      service: lignes(destinatairesTxt)[0] || enquete.services?.[0] || '',
      signature: signatureActive(signature)
        ? {
            mention: signature.mention,
            cachet: signature.mode === 'mention_cachet' ? signature.cachet : undefined,
            largeurPx: signature.largeurPx,
          }
        : undefined,
    }),
    [template.titre, texte, enquete, destinatairesTxt, signature],
  );

  const handleCopy = async () => {
    if (await copyPlainToClipboard(texte)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDocx = async () => {
    setBusy('docx');
    try { await downloadActeDocx(acte); } finally { setBusy(null); }
  };

  const handlePdf = async () => {
    setBusy('pdf');
    try { await downloadActePdf(acte); } finally { setBusy(null); }
  };

  const handleSaveTemplate = useCallback(async () => {
    if (!editingTemplate) return;
    await SiralBridge.setData(APP_CONFIG.STORAGE_KEYS.SAISINE_TEMPLATE, editingTemplate);
    setTemplate(editingTemplate);
    setEditingTemplate(null);
  }, [editingTemplate]);

  const majSignature = useCallback(async (s: SignatureElectronique) => {
    setSignature(s);
    await saveSignature(s);
  }, []);

  const handleCachet = async (file: File | undefined) => {
    if (!file) return;
    setSignatureErreur('');
    try {
      const dataUri = await lireCachet(file);
      await majSignature({ ...signature, cachet: dataUri, mode: 'mention_cachet' });
    } catch (e) {
      setSignatureErreur(e instanceof Error ? e.message : 'Image illisible.');
    }
  };

  const setField = (key: keyof SaisineTemplate, value: string) =>
    setEditingTemplate((prev) => (prev ? { ...prev, [key]: value } : prev));

  const champ = 'w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl bg-white max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Soit-transmis de saisine — Enquête N° {enquete.numero}
          </DialogTitle>
        </DialogHeader>

        {editingTemplate ? (
          // ── VUE ÉDITEUR DE TRAME ──
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Modifiez les formules figées de l'acte. Les chefs de poursuite, le
              régime de l'article 706-80, la motivation de criminalité grave, le
              destinataire et la date restent calculés à chaque génération.
            </p>
            {FIELD_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {group.title}
                </h4>
                {group.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    {f.multiline ? (
                      <textarea
                        value={editingTemplate[f.key]}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className={`${champ} h-20 resize-none`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={editingTemplate[f.key]}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className={champ}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div className="flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 gap-1"
                onClick={() => setShowConfirmReset(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>
                  Annuler
                </Button>
                <Button size="sm" onClick={handleSaveTemplate}>
                  Enregistrer la trame
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // ── VUE NORMALE ──
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500 flex-1">
                Les chefs de poursuite et leurs articles viennent du référentiel NATINF ;
                le régime de l'article 706-80 et la motivation de criminalité grave sont
                proposés, à relire avant envoi.
              </p>
              <button
                type="button"
                title="Modifier la trame de rédaction"
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                onClick={() => setEditingTemplate({ ...template })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            {avertissements.length > 0 && (
              <div className="p-3 border border-amber-200 bg-amber-50 rounded-lg space-y-1">
                {avertissements.map((a) => (
                  <p key={a} className="text-xs text-amber-800 flex gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>{a}</span>
                  </p>
                ))}
              </div>
            )}

            {/* ── Saisine ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Saisine</h4>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Service(s) destinataire(s) — une ligne par service
                </label>
                <textarea
                  value={destinatairesTxt}
                  onChange={(e) => setDestinatairesTxt(e.target.value)}
                  className={`${champ} h-14 resize-none`}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={coSaisine}
                  onChange={(e) => setCoSaisine(e.target.checked)}
                />
                Co-saisine (deux services)
              </label>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Visas — une ligne par « Vu … »
                </label>
                <textarea
                  value={visasTxt}
                  onChange={(e) => setVisasTxt(e.target.value)}
                  className={`${champ} h-14 resize-none`}
                />
              </div>
            </section>

            {/* ── Chefs de poursuite ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Chefs de poursuite
              </h4>
              <textarea
                value={preventionsTxt}
                onChange={(e) => setPreventionsTxt(e.target.value)}
                className={`${champ} h-32 resize-none font-mono text-xs`}
              />
              <p className="text-[11px] text-gray-400">
                Un chef par bloc, séparés par une ligne vide. Prérempli depuis les NATINF de l'enquête.
              </p>
              <input
                type="text"
                value={commis}
                onChange={(e) => setCommis(e.target.value)}
                placeholder="Commis le 26 mai 2024 à CAYEUX SUR MER (80)"
                className={champ}
              />
            </section>

            {/* ── Régime et motivation ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Régime et criminalité grave
              </h4>
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Famille de contentieux
                  </label>
                  <select
                    value={familleId}
                    onChange={(e) => changerFamille(e.target.value)}
                    className={champ}
                  >
                    <option value="">— aucune —</option>
                    {FAMILLES.map((f) => (
                      <option key={f.id} value={f.id}>{f.libelle}</option>
                    ))}
                  </select>
                </div>
                <div className="w-40">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Quantum encouru
                  </label>
                  <input
                    type="text"
                    value={quantum}
                    onChange={(e) => setQuantum(e.target.value)}
                    placeholder="dix ans"
                    className={champ}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={bandeOrganisee}
                  onChange={(e) => changerBandeOrganisee(e.target.checked)}
                />
                Bande organisée retenue (art. 132-71 C. pén.)
              </label>

              {bandeOrganisee && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Attendus caractérisant la bande organisée (facultatif, un paragraphe par bloc)
                  </label>
                  <textarea
                    value={attendusBO}
                    onChange={(e) => setAttendusBO(e.target.value)}
                    placeholder="Attendu que les faits décrits dans l'enquête ciblée relèvent manifestement de la bande organisée au sens de l'article 132-71 du code pénal ;"
                    className={`${champ} h-24 resize-none`}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Régime de l'article 706-80
                </label>
                <select
                  value={regime}
                  onChange={(e) => setRegime(e.target.value as Regime706)}
                  className={champ}
                >
                  {(Object.keys(REGIME_LABELS) as Regime706[]).map((r) => (
                    <option key={r} value={r}>{REGIME_LABELS[r]}</option>
                  ))}
                </select>
                {regime === 'droit_commun' && (
                  <label className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                    <input
                      type="checkbox"
                      checked={mentionner706}
                      onChange={(e) => setMentionner706(e.target.checked)}
                    />
                    Mentionner expressément que le 706-80 n'est pas applicable
                  </label>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">
                  Circonstances retenues
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {motifs.map((m) => (
                    <label key={m.id} className="flex items-start gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={motifsCoches.includes(m.id)}
                        onChange={(e) => {
                          setMotifsCoches((prev) =>
                            e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                          );
                          setMotivationManuelle(null);
                        }}
                      />
                      <span title={m.texte}>{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">
                    Autorisation d'accès aux données de trafic et de localisation
                  </label>
                  {motivationManuelle !== null && (
                    <button
                      type="button"
                      className="text-[11px] text-gray-500 hover:text-gray-700 underline"
                      onClick={() => setMotivationManuelle(null)}
                    >
                      revenir au texte proposé
                    </button>
                  )}
                </div>
                <textarea
                  value={motivation}
                  onChange={(e) => setMotivationManuelle(e.target.value)}
                  className={`${champ} h-32 resize-none`}
                />
              </div>
            </section>

            {/* ── Autorisations et diligences ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Autorisations propres au dossier
              </h4>
              <textarea
                value={autorisationsTxt}
                onChange={(e) => setAutorisationsTxt(e.target.value)}
                placeholder="Autorisation de bris de scellés pour exploitation des scellés 3/SCANIA à 8/SCANIA"
                className={`${champ} h-16 resize-none`}
              />
              <input
                type="text"
                value={extractionDetenu}
                onChange={(e) => setExtractionDetenu(e.target.value)}
                placeholder="Autorisation d'extraction du détenu NOM Prénom écrou 00000, de le faire surveiller…"
                className={champ}
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Diligences prioritaires — une par ligne, numérotées dans l'acte
                </label>
                <textarea
                  value={diligencesTxt}
                  onChange={(e) => setDiligencesTxt(e.target.value)}
                  className={`${champ} h-20 resize-none`}
                />
              </div>
              <input
                type="text"
                value={echeance}
                onChange={(e) => setEcheance(e.target.value)}
                placeholder="Échéance d'une première actualisation (ex. le 17 août 2026)"
                className={champ}
              />
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={suiviParSection}
                  onChange={(e) => setSuiviParSection(e.target.checked)}
                />
                Suivi « directement ou par le biais de la section criminalité organisée »
              </label>
            </section>

            {/* ── Signature ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Signature apposée aux exports
              </h4>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Apposer</label>
                  <select
                    value={signature.mode}
                    onChange={(e) =>
                      majSignature({
                        ...signature,
                        mode: e.target.value as SignatureElectronique['mode'],
                      })
                    }
                    className={champ}
                  >
                    <option value="aucune">Rien (acte à signer à la main)</option>
                    <option value="mention">Mention seule</option>
                    <option value="mention_cachet">Mention et cachet</option>
                  </select>
                </div>
                {signature.mode === 'mention_cachet' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Cachet (PNG ou JPEG)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleCachet(e.target.files?.[0])}
                      className="text-xs"
                    />
                  </div>
                )}
              </div>
              {signature.mode !== 'aucune' && (
                <textarea
                  value={signature.mention}
                  onChange={(e) => majSignature({ ...signature, mention: e.target.value })}
                  placeholder={'Signé électroniquement :\nPrénom NOM L0000000'}
                  className={`${champ} h-16 resize-none`}
                />
              )}
              {signatureErreur && <p className="text-xs text-red-600">{signatureErreur}</p>}
              {signature.mode === 'mention_cachet' && signature.cachet && (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signature.cachet} alt="Cachet" className="h-16 w-auto border border-gray-200 rounded" />
                  <button
                    type="button"
                    className="text-[11px] text-gray-500 hover:text-red-600 underline"
                    onClick={() => majSignature({ ...signature, cachet: undefined })}
                  >
                    retirer le cachet
                  </button>
                </div>
              )}
              <p className="text-[11px] text-gray-400">
                Reproduction de la mention et du cachet du magistrat : aucune empreinte
                cryptographique n'est calculée. Le cachet reste sur ce poste. Il n'apparaît
                pas dans un export Word passant par une trame de forme (le texte, si).
              </p>
            </section>

            {/* ── Aperçu ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Aperçu — {formatDateLong()}
              </h4>
              <pre className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs whitespace-pre-wrap max-h-72 overflow-y-auto font-sans text-gray-800">
                {texte}
              </pre>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copié' : 'Copier'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={busy !== null}
                onClick={handleDocx}
              >
                <FileText className="h-4 w-4" />
                {busy === 'docx' ? 'Génération…' : 'Word'}
              </Button>
              <Button size="sm" className="gap-2" disabled={busy !== null} onClick={handlePdf}>
                <FileDown className="h-4 w-4" />
                {busy === 'pdf' ? 'Génération…' : 'PDF'}
              </Button>
            </div>
          </div>
        )}

        {showConfirmReset && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
              <p className="text-sm font-medium text-gray-800">Réinitialiser la trame ?</p>
              <p className="text-xs text-gray-500">
                Les formules reviendront à leur texte d'origine.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowConfirmReset(false)}>
                  Annuler
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setEditingTemplate({ ...DEFAULT_SAISINE_TEMPLATE });
                    setShowConfirmReset(false);
                  }}
                >
                  Réinitialiser
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
