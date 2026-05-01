'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, AlertTriangle, Info, Scale, Gavel } from 'lucide-react';
import { getCasDPById, SEUIL_MOTIVATION_RENFORCEE_MOIS, DELAI_DML_JOURS } from '@/config/dpRegimes';
import {
  getDureeCumuleeDPMois,
  getMoisRestantsAvantMaxLegal,
  motivationRenforceeRequise,
  peutDemanderProlongationExceptionnelle,
} from '@/utils/instructionUtils';
import type { MisEnExamen } from '@/types/instructionTypes';

interface Props {
  mex: MisEnExamen;
}

/**
 * Fiche pédagogique « vérification légale DP » dépliable, qui explique
 * pourquoi tel badge s'affiche et rappelle les références légales.
 *
 * Affichée sous la section « Mesures de sûreté » de la carte MEX.
 */
export const VerificationLegaleDP = ({ mex }: Props) => {
  const [open, setOpen] = useState(false);

  const isDetenu = mex.mesureSurete.type === 'detenu';
  const cas = mex.mesureSurete.type === 'detenu'
    ? getCasDPById(mex.mesureSurete.casDPId)
    : undefined;
  const cumule = getDureeCumuleeDPMois(mex);
  const restant = getMoisRestantsAvantMaxLegal(mex);
  const motivRenforcee = motivationRenforceeRequise(mex);
  const peutCHINS = peutDemanderProlongationExceptionnelle(mex);

  return (
    <div className="border border-blue-200 rounded-lg overflow-hidden bg-blue-50/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-blue-100/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <BookOpen className="h-4 w-4" />
          Vérification légale DP — pédagogie & rappels
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-blue-700" /> : <ChevronDown className="h-4 w-4 text-blue-700" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 text-xs text-gray-700">
          {/* Statut courant */}
          {isDetenu && cas ? (
            <Bloc title={`Cas applicable : ${cas.label}`} icon={Scale} tone="blue">
              <div className="space-y-1">
                <Refs label="Référence" value={cas.article} />
                <Refs label="Régime" value={cas.regime === 'criminel' ? 'Criminel' : 'Correctionnel'} />
                <Refs label="Durée initiale" value={`${cas.dureeInitialeMois} mois`} />
                <Refs label="Durée maximale légale" value={`${cas.dureeMaxMois} mois`} />
                <Refs
                  label="Tranches de prolongation"
                  value={cas.trancheProlongationMois > 0 ? `${cas.trancheProlongationMois} mois` : 'Aucune prolongation possible'}
                />
                <Refs
                  label="Cumul actuel"
                  value={`${cumule} / ${cas.dureeMaxMois} mois`}
                  highlight={restant !== null && restant <= 0 ? 'red' : restant !== null && restant <= 6 ? 'amber' : undefined}
                />
                {cas.description && <p className="italic text-gray-500 mt-1">{cas.description}</p>}
              </div>
            </Bloc>
          ) : (
            <Bloc title="Mesure courante : non détenu" icon={Info} tone="gray">
              <p>Cette fiche pédagogique s'enrichit dès qu'un placement en DP est enregistré.</p>
            </Bloc>
          )}

          {/* Motivation renforcée */}
          {isDetenu && cas?.regime === 'correctionnel' && (
            <Bloc
              title="Motivation renforcée (au-delà de 8 mois)"
              icon={AlertTriangle}
              tone={motivRenforcee ? 'amber' : 'gray'}
            >
              <p>
                En matière correctionnelle, les décisions de prolongation de DP ou de rejet de DML
                <strong> au-delà de {SEUIL_MOTIVATION_RENFORCEE_MOIS} mois</strong> doivent intégrer une
                motivation renforcée expliquant en quoi une ARSEM ou un CJ avec BAR seraient insuffisants
                (<RefArt>art 137-3</RefArt> et dépêche du 23 décembre 2021).
              </p>
              <p className="mt-1">
                Crim., 1er octobre 2024 : est suffisamment motivée la décision exposant qu'au regard des
                critères de l'art 144, l'ARSE ou le CJ sont insuffisants — l'ARSEM n'étant qu'une
                modalité de l'ARSE.
              </p>
              {motivRenforcee && (
                <p className="mt-2 font-semibold text-amber-800">
                  ⚠ Vos réquisitions de prolongation ou de rejet de DML doivent désormais être renforcées
                  (cumul actuel : {cumule} mois).
                </p>
              )}
            </Bloc>
          )}

          {/* Prolongation exceptionnelle CHINS */}
          {isDetenu && cas?.prolongationExceptionnelleCHINS && cas.prolongationExceptionnelle && (
            <Bloc
              title="Prolongation exceptionnelle CHINS"
              icon={Gavel}
              tone={peutCHINS ? 'purple' : 'gray'}
            >
              <p>
                À titre exceptionnel, la CHINS peut accorder une prolongation supplémentaire de
                <strong> {cas.prolongationExceptionnelle.dureeMois} mois</strong>, renouvelable jusqu'à
                <strong> {cas.prolongationExceptionnelle.nbMax} fois</strong>, lorsque les investigations
                du JI doivent être poursuivies et que la mise en liberté du MEX causerait pour la
                sécurité des personnes et des biens un risque d'une particulière gravité (
                {cas.regime === 'criminel'
                  ? <RefArt>art 145-2 al 3</RefArt>
                  : cas.id === 'del-extra'
                  ? <RefArt>art 145-1 al 3</RefArt>
                  : <RefArt>art 706-24-3 al 3</RefArt>}
                ).
              </p>
              {peutCHINS && (
                <p className="mt-2 font-semibold text-purple-800">
                  Vous pouvez solliciter cette prolongation : durée légale max atteinte et quota non
                  épuisé ({(cas.prolongationExceptionnelle.nbMax) - (mex.mesureSurete.type === 'detenu' ? (mex.mesureSurete.nbProlongationsExceptionnelles || 0) : 0)} restante(s)).
                </p>
              )}
            </Bloc>
          )}

          {isDetenu && cas?.id === 'del-stup-am-bo' && (
            <Bloc title="Cas particulier — pas de prolongation exceptionnelle" icon={Info} tone="gray">
              <p>
                Pour ce cas (<RefArt>art 145-1-1</RefArt> §1), la prolongation exceptionnelle est
                <strong> exclue</strong> (dépêche du 14 juin 2025).
              </p>
            </Bloc>
          )}

          {/* Critères généraux art 144 */}
          <Bloc title="Critères de placement / prolongation (art 144)" icon={Scale} tone="blue">
            <p className="mb-1">
              La DP ne peut être ordonnée ou prolongée que si elle constitue
              <strong> l'unique moyen</strong> de parvenir à l'un des objectifs suivants, et qu'aucun
              CJ ou ARSE ne suffirait (<RefArt>art 137</RefArt>) :
            </p>
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>Conserver les preuves ou indices matériels nécessaires à la manifestation de la vérité</li>
              <li>Empêcher une pression sur les témoins / victimes / leurs familles</li>
              <li>Empêcher une concertation frauduleuse avec coauteurs ou complices</li>
              <li>Protéger la personne mise en examen <span className="text-gray-400">(rare)</span></li>
              <li>Garantir le maintien à disposition de la justice (risque de fuite)</li>
              <li>Mettre fin à l'infraction ou prévenir son renouvellement</li>
              <li>
                Mettre fin au trouble exceptionnel et persistant à l'ordre public — ce trouble ne peut résulter
                du seul retentissement médiatique ; <strong>non mobilisable en correctionnelle</strong>
              </li>
            </ol>
          </Bloc>

          {/* Statut suspects */}
          <Bloc title="Statut des suspects à l'instruction" icon={Info} tone="blue">
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Aucun indice → <strong>simple témoin</strong></li>
              <li>Simples indices de culpabilité → simple témoin ; le JI <em>peut</em> placer sous statut de TA</li>
              <li>Indice grave OU plusieurs indices légers et concordants → simple témoin / TA / MEX (art 80-1)</li>
              <li>
                Indices graves <strong>ET</strong> concordants → mise en examen ou TA obligatoire (
                <RefArt>art 105</RefArt>, <RefArt>art 113-6 al 2</RefArt> ; Crim. 15 février 2011)
              </li>
            </ul>
          </Bloc>

          {/* DML */}
          <Bloc title="DML — délais procéduraux" icon={Gavel} tone="purple">
            <p>
              Le JI transmet la DML <strong>sans délai</strong> au PR qui prend ses réquisitions écrites motivées.
              Sauf suite favorable, le JI doit la transmettre <strong>dans les {DELAI_DML_JOURS} jours</strong>
              suivant la communication au PR au JLD avec son avis motivé. Le JLD statue
              <strong> dans les 5 jours ouvrables</strong> sans débat (<RefArt>art 148</RefArt>).
            </p>
          </Bloc>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────
// Sous-composants
// ──────────────────────────────────────────────

const Bloc = ({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ElementType;
  tone: 'blue' | 'amber' | 'red' | 'purple' | 'gray';
  children?: React.ReactNode;
}) => {
  const colors: Record<string, string> = {
    blue:   'bg-blue-50 border-blue-200 text-blue-900',
    amber:  'bg-amber-50 border-amber-200 text-amber-900',
    red:    'bg-red-50 border-red-200 text-red-900',
    purple: 'bg-purple-50 border-purple-200 text-purple-900',
    gray:   'bg-gray-50 border-gray-200 text-gray-700',
  };
  const iconColors: Record<string, string> = {
    blue: 'text-blue-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    purple: 'text-purple-600',
    gray: 'text-gray-500',
  };
  return (
    <div className={`rounded border p-2 ${colors[tone]}`}>
      <div className="flex items-center gap-1.5 mb-1 font-semibold">
        <Icon className={`h-3.5 w-3.5 ${iconColors[tone]}`} />
        {title}
      </div>
      <div className="text-gray-700">{children}</div>
    </div>
  );
};

const Refs = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: 'red' | 'amber';
}) => (
  <div className="flex justify-between items-center gap-2">
    <span className="text-gray-500">{label}</span>
    <span
      className={`font-medium ${
        highlight === 'red'
          ? 'text-red-700'
          : highlight === 'amber'
          ? 'text-amber-700'
          : 'text-gray-800'
      }`}
    >
      {value}
    </span>
  </div>
);

const RefArt = ({ children }: { children?: React.ReactNode }) => (
  <span className="font-mono text-[10px] bg-gray-100 px-1 py-0.5 rounded border border-gray-200">
    {children}
  </span>
);
