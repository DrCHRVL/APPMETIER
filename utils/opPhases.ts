import { Enquete, OPPhase } from '@/types/interfaces';

// Délai par défaut appliqué à une OP quand aucune date de fin n'est saisie : 96h.
export const OP_DEFAULT_DURATION_DAYS = 4;

type EnqueteLike = Pick<Enquete, 'dateOP' | 'opPhases'>;

// Retourne la liste des phases d'OP, en retombant sur le legacy `dateOP` s'il
// n'y a pas (encore) de tableau `opPhases`. Garantit toujours un tableau.
export const getOPPhases = (enquete: EnqueteLike): OPPhase[] => {
  if (enquete.opPhases && enquete.opPhases.length > 0) return enquete.opPhases;
  if (enquete.dateOP) return [{ id: 0, dateDebut: enquete.dateOP }];
  return [];
};

// Date de fin effective d'une phase : valeur saisie si présente, sinon
// `dateDebut + 96h` (4 jours).
export const getOPPhaseEndDate = (phase: OPPhase): Date => {
  const d = new Date(phase.dateFin || phase.dateDebut);
  d.setHours(0, 0, 0, 0);
  if (!phase.dateFin) d.setDate(d.getDate() + OP_DEFAULT_DURATION_DAYS);
  return d;
};

// Génère un id stable pour une nouvelle phase à partir des phases existantes.
export const nextOPPhaseId = (phases: OPPhase[] | undefined): number => {
  if (!phases || phases.length === 0) return 1;
  return Math.max(...phases.map(p => p.id)) + 1;
};
