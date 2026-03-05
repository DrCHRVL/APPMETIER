import { EnqueteInstruction } from '@/types/interfaces';

// Helper pour calculer les dates DP
export const calculateDPDates = (
  datePlacement: string, 
  dureeMois: number
): { dateFin: string } => {
  const date = new Date(datePlacement);
  date.setMonth(date.getMonth() + dureeMois);
  return {
    dateFin: date.toISOString().split('T')[0]
  };
};

// Helper pour calculer le nombre total de débats (sans double comptage)
export const calculateTotalDebats = (
  instruction: EnqueteInstruction
): number => {
  if (!instruction) return 0;
  
  const debatsParquet = instruction.debatsParquet?.length || 0;
  const debatsFromOP = (instruction.ops || []).reduce((sum, op) => 
    sum + (op.nbDebats || 0), 0
  );
  
  // Éviter le double comptage : ne compter que les débats qui ne viennent pas d'OP
  const debatsNonOP = instruction.debatsParquet?.filter(
    debat => debat.sourceType !== 'op_generated'
  ).length || 0;
  
  return debatsNonOP + debatsFromOP;
};

// Helper pour calculer l'échéance DML (10 jours ouvrables)
export const calculateDMLEcheance = (dateDepot: string): string => {
  const date = new Date(dateDepot);
  // Ajouter 10 jours ouvrables (nouvelle loi)
  let count = 0;
  while (count < 10) {
    date.setDate(date.getDate() + 1);
    // Skip weekends
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      count++;
    }
  }
  return date.toISOString().split('T')[0];
};

// Helper pour calculer l'alerte DP
export const calculateDPAlert = (dateFin: string): { alerteActive: boolean; joursRestants: number } => {
  const now = new Date();
  const fin = new Date(dateFin);
  const diffTime = fin.getTime() - now.getTime();
  const joursRestants = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return {
    alerteActive: joursRestants <= 30 && joursRestants > 0,
    joursRestants: Math.max(0, joursRestants)
  };
};