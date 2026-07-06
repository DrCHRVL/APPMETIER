import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { useAIRConvocationConfig } from '@/hooks/useAIRConvocationConfig';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, ComposedChart, Legend
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, CheckCircle, XCircle, Calendar, Clock, Target,
  AlertTriangle, Download, MapPin, User, FileText, Activity, Award, AlertCircle, ChevronDown, ChevronUp, RefreshCw, X
} from 'lucide-react';

// Interface basée sur vos vraies données AIR
interface AIRImportData {
  refAEM: string;
  nomPrenom: string;
  dateReception: string;
  dateCloture?: string;
  dateFinPriseEnCharge?: string;
  faits: string;
  referent?: string;
  secteurGeographique?: string;
  nombreEntretiensAIR: number;
  nombreRencontresPR?: number;
  nombreCarences?: number;
  resultatMesure?: string;
  natureFinAIR?: string;
  origine?: string;
  dureeEnMois?: number;
  statut?: 'en_cours' | 'reussite' | 'echec' | 'termine';
}

interface AIRDashboardIntegratedProps {
  mesures: AIRImportData[];
  isLoading?: boolean;
  className?: string;
}

// Ligne de mesure déjà normalisée (dates formatées) pour l'affichage et la copie.
interface MesureLigneCopie {
  ref?: string;
  nom?: string;
  dateReception?: string;
  referent?: string;
}

// Formate une liste de mesures en texte prêt à coller dans un e-mail.
const formatMesuresPourCopie = (titre: string, lignes: MesureLigneCopie[]): string => {
  const entete = `${titre} (${lignes.length})`;
  const corps = lignes
    .map(l => `- ${l.ref || ''} — ${l.nom || ''} — Reçue le ${l.dateReception || 'inconnue'} — Référent : ${l.referent || 'Non assigné'}`)
    .join('\n');
  return `${entete}\n\n${corps}`;
};

export const AIRDashboardIntegrated = ({ 
  mesures, 
  isLoading = false,
  className = "" 
}: AIRDashboardIntegratedProps) => {
  const [showAnciennesDetails, setShowAnciennesDetails] = useState(false);
  const [showPropositionsDetails, setShowPropositionsDetails] = useState(false);
  const [showAlerteDetails, setShowAlerteDetails] = useState<number | null>(null);
  // Référent dont on affiche le détail des mesures en cours (modal). null = fermé.
  const [selectedReferent, setSelectedReferent] = useState<string | null>(null);

  // Configuration des délais (seuils d'alertes de convocation + mesures
  // anciennes), éditable depuis l'écran Paramètres → module AIR.
  const { config: convocConfig } = useAIRConvocationConfig();

  // Parser les dates - format français dd/mm/yyyy
  const parseExcelDate = (dateStr: any): Date | null => {
    if (!dateStr) return null;
    
    if (dateStr instanceof Date) {
      return dateStr;
    }
    
    if (typeof dateStr === 'string') {
      // Format français : "08/01/2025" (jour/mois/année)
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // Mois en base 0
        const year = parseInt(parts[2]);
        return new Date(year, month, day);
      }
      
      // Fallback pour autres formats
      return new Date(dateStr);
    }
    
    if (typeof dateStr === 'number') {
      // Format Excel : le n° de série compte les jours depuis le 30/12/1899.
      // Cet ancrage absorbe le bug de l'année bissextile 1900 d'Excel
      // (qui compte un 29/02/1900 fictif) pour toutes les dates modernes.
      // Calcul en UTC pour éviter tout décalage lié aux changements d'heure.
      const ms = Date.UTC(1899, 11, 30) + dateStr * 24 * 60 * 60 * 1000;
      const utc = new Date(ms);
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    
    return null;
  };

  // Normaliser les infractions selon les catégories AEM officielles
  const normalizeInfraction = (faits: string): string => {
    if (!faits) return 'Autres';
    
    const f = faits.toLowerCase().trim();
    
    if (f.includes('ils usage') || f.includes('usage')) return 'Usage de stupéfiants';
    if (f.includes('conduite sous stups') || f.includes('conduite') && f.includes('stup')) return 'Conduite sous stupéfiants';
    if (f.includes('vif') && f.includes('vvc') || f.includes('violence') && f.includes('conjugal')) return 'Violences conjugales';
    if (f.includes('cea') || f.includes('conduite') && f.includes('alcool')) return 'Conduite sous alcool';
    if (f.includes('vv') && !f.includes('vvc') || f.includes('violences volontaires')) return 'Violences volontaires';
    if (f.includes('vif') && f.includes('ascendant') || f.includes('violence') && f.includes('ascendant')) return 'Violences sur ascendant';
    if (f.includes('vol') && !f.includes('revolution')) return 'Vol';
    if (f.includes('menace')) return 'Menaces';
    if (f.includes('ils détention') || f.includes('détention') && f.includes('stup')) return 'Détention de stupéfiants';
    if (f.includes('appel tel malveillant') || f.includes('appel') && f.includes('malveillant')) return 'Appels téléphoniques malveillants';
    
    return 'Autres';
  };

  // Extraire l'année UNIQUEMENT de la date de réception
  const getYear = (mesure: AIRImportData): number => {
    const dateReception = parseExcelDate(mesure.dateReception);
    return dateReception ? dateReception.getFullYear() : new Date().getFullYear();
  };

  // Détection du résultat d'une mesure — tolérante à la casse, aux accents
  // et aux espaces parasites. Centralisée pour garantir la cohérence de TOUS
  // les taux de réussite du module (global, par année, par référent).
  const estReussite = (resultat?: string): boolean =>
    !!resultat && resultat.toLowerCase().trim().includes('réussite');

  const estEchec = (resultat?: string): boolean => {
    if (!resultat) return false;
    const r = resultat.toLowerCase().trim();
    return r.includes('échec') || r.includes('echec');
  };

// Statistiques principales avec calcul par année de clôture
const stats = useMemo(() => {
  const total = mesures.length;
  const enCours = mesures.filter(m => !m.dateCloture && !m.dateFinPriseEnCharge).length;
  const cloturees = mesures.filter(m => m.dateCloture || m.dateFinPriseEnCharge).length;

  // Stats globales (toutes mesures clôturées)
  const toutesLesMesuresCloturees = mesures.filter(m => m.dateCloture || m.dateFinPriseEnCharge);
  const reussitesTotal = toutesLesMesuresCloturees.filter(m => estReussite(m.resultatMesure)).length;
  const echecsTotal = toutesLesMesuresCloturees.filter(m => estEchec(m.resultatMesure)).length;
  const mesuresAvecResultatTotal = reussitesTotal + echecsTotal;
  const tauxReussite = mesuresAvecResultatTotal > 0 ?
    Math.round((reussitesTotal / mesuresAvecResultatTotal) * 100) : 0;

  // La ventilation par année (2024 / 2025 / 2026 …) est calculée dynamiquement
  // dans le mémo `statsAnnuelles` ci-dessous et n'est plus figée ici.

  return {
    total,
    enCours,
    cloturees,
    reussites: reussitesTotal,
    echecs: echecsTotal,
    tauxReussite,
    anciennes: mesures.filter(m => {
      if (m.dateCloture || m.dateFinPriseEnCharge) return false;
      const dateReception = parseExcelDate(m.dateReception);
      const seuilAncien = new Date();
      seuilAncien.setMonth(seuilAncien.getMonth() - convocConfig.ancienneteMois);
      return dateReception && dateReception < seuilAncien;
    }).length,
    moyenneEntretiensPR: total > 0 ?
      Math.round((mesures.reduce((acc, m) => acc + (m.nombreRencontresPR || 0), 0) / total) * 10) / 10 : 0
  };
}, [mesures, convocConfig]);

  // Statistiques annuelles : ventilation par année sous les cartes KPI et série
  // du graphe d'évolution annuelle. Deux bases distinctes, cohérentes avec le
  // reste du dashboard :
  //  - Total          → par année de RÉCEPTION (cohorte reçue dans l'année)
  //  - Réussites / Échecs / Clôturées / Taux → par année de CLÔTURE
  // Le taux est calculé dès qu'une année a au moins une mesure décidée, même si
  // l'année n'est pas terminée (cas de l'année courante).
  const statsAnnuelles = useMemo(() => {
    const parReception: Record<number, number> = {};
    const parCloture: Record<number, { cloturees: number; reussites: number; echecs: number }> = {};
    const anneesSet = new Set<number>();

    mesures.forEach(m => {
      const rec = parseExcelDate(m.dateReception);
      if (rec) {
        const y = rec.getFullYear();
        parReception[y] = (parReception[y] || 0) + 1;
        anneesSet.add(y);
      }
      const clo = parseExcelDate(m.dateCloture) || parseExcelDate(m.dateFinPriseEnCharge);
      if (clo) {
        const y = clo.getFullYear();
        if (!parCloture[y]) parCloture[y] = { cloturees: 0, reussites: 0, echecs: 0 };
        parCloture[y].cloturees++;
        if (estReussite(m.resultatMesure)) parCloture[y].reussites++;
        else if (estEchec(m.resultatMesure)) parCloture[y].echecs++;
        anneesSet.add(y);
      }
    });

    const anneeCourante = new Date().getFullYear();
    const tauxCloture = (y: number): number | null => {
      const c = parCloture[y];
      if (!c) return null;
      const decidees = c.reussites + c.echecs;
      return decidees > 0 ? Math.round((c.reussites / decidees) * 100) : null;
    };

    // Années à afficher sous les cartes : les 3 plus récentes (année courante
    // incluse), pour rester lisible même après plusieurs années de données.
    const toutesAnnees = Array.from(anneesSet)
      .filter(y => y >= 2000 && y <= anneeCourante)
      .sort((a, b) => a - b);
    const anneesAffichees = toutesAnnees.slice(-3);

    // Série complète pour le graphe d'évolution annuelle (par année de clôture).
    const evolutionAnnuelle = toutesAnnees
      .filter(y => parCloture[y])
      .map(y => ({
        annee: String(y),
        reussites: parCloture[y].reussites,
        echecs: parCloture[y].echecs,
        cloturees: parCloture[y].cloturees,
        taux: tauxCloture(y) ?? 0,
      }));

    return { parReception, parCloture, tauxCloture, anneesAffichees, anneeCourante, evolutionAnnuelle };
  }, [mesures]);

  // Statistiques avec historique
  const statsWithHistory = useMemo(() => {
    const allYears = Array.from(new Set(mesures.map(getYear))).sort();
    
    const statsByYear = allYears.reduce((acc, year) => {
      const mesuresYear = mesures.filter(m => getYear(m) === year);
      const cloturees = mesuresYear.filter(m => m.dateCloture || m.dateFinPriseEnCharge);
      const reussites = cloturees.filter(m => estReussite(m.resultatMesure));
      const echecs = cloturees.filter(m => estEchec(m.resultatMesure));
      
      acc[year] = {
        total: mesuresYear.length,
        cloturees: cloturees.length,
        reussites: reussites.length,
        echecs: echecs.length,
        tauxReussite: (reussites.length + echecs.length) > 0 ? 
          Math.round((reussites.length / (reussites.length + echecs.length)) * 100) : 0
      };
      return acc;
    }, {} as { [year: number]: any });

    const seuilAncien = new Date();
    seuilAncien.setMonth(seuilAncien.getMonth() - convocConfig.ancienneteMois);

    const mesuresAnciennes = mesures.filter(m => {
      if (m.dateCloture || m.dateFinPriseEnCharge) return false;
      const dateReception = parseExcelDate(m.dateReception);
      return dateReception && dateReception < seuilAncien;
    });

    const seuilTresAncien = new Date();
    seuilTresAncien.setMonth(seuilTresAncien.getMonth() - convocConfig.tresAncienneteMois);

    const mesuresTresAnciennes = mesures.filter(m => {
      if (m.dateCloture || m.dateFinPriseEnCharge) return false;
      const dateReception = parseExcelDate(m.dateReception);
      return dateReception && dateReception < seuilTresAncien;
    });

    return {
      actuel: stats,
      parAnnee: statsByYear,
      mesuresAnciennes,
      mesuresTresAnciennes,
      allYears
    };
  }, [mesures, stats, convocConfig]);

  // Données pour le suivi 36 mois glissants du stock de mesures + statistiques d'évolution + alertes prédictives
  const suivi36MoisData = useMemo(() => {
    const moisData: { [key: string]: { enCours: number, total: number } } = {};
    
    // Initialiser les 36 derniers mois
    for (let i = 35; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      moisData[key] = { enCours: 0, total: 0 };
    }

    // Pour chaque mois, calculer le stock de mesures en cours à cette date
    Object.keys(moisData).forEach(key => {
      const [year, month] = key.split('-');
      const dateFin = new Date(parseInt(year), parseInt(month) - 1 + 1, 0); // Dernier jour du mois
      
      let enCours = 0;
      let total = 0;
      
      mesures.forEach(mesure => {
        const dateReception = parseExcelDate(mesure.dateReception);
        const dateCloture = parseExcelDate(mesure.dateCloture) || parseExcelDate(mesure.dateFinPriseEnCharge);
        
        // Si la mesure était déjà reçue à cette date
        if (dateReception && dateReception <= dateFin) {
          total++;
          
          // Si elle n'était pas encore clôturée à cette date (ou jamais clôturée)
          if (!dateCloture || dateCloture > dateFin) {
            enCours++;
          }
        }
      });
      
      moisData[key] = { enCours, total };
    });

    const dataArray = Object.keys(moisData)
      .sort()
      .map(key => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return {
          mois: date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
          enCours: moisData[key].enCours,
          total: moisData[key].total
        };
      });

    // Calcul des statistiques d'évolution
    const dernier = dataArray[dataArray.length - 1];
    const precedent = dataArray[dataArray.length - 13]; // 12 mois avant
    
    // Taux d'évolution du stock en cours (sur 12 mois)
    const evolutionEnCours = precedent && precedent.enCours > 0 
      ? Math.round(((dernier.enCours - precedent.enCours) / precedent.enCours) * 100)
      : dernier.enCours > 0 ? 100 : 0; // Si pas de données précédentes mais stock actuel > 0
    
    // Évolution de l'écart entre total et en cours (capacité de traitement)
    const ecartActuel = dernier.total - dernier.enCours; // Mesures traitées
    const ecartPrecedent = precedent ? precedent.total - precedent.enCours : 0;
    const evolutionCapacite = precedent && ecartPrecedent > 0
      ? Math.round(((ecartActuel - ecartPrecedent) / ecartPrecedent) * 100)
      : 0;

    // Analyse prédictive des alertes
    const analysePredicitive = () => {
      // Analyser les 6 derniers mois pour détecter les tendances
      const derniersMois = dataArray.slice(-6);
      const moyenneEvolutionMensuelle = derniersMois.length >= 2 
        ? (derniersMois[derniersMois.length - 1].enCours - derniersMois[0].enCours) / (derniersMois.length - 1)
        : 0;

      // Calculer la tendance d'augmentation mensuelle moyenne
      const tauxCroissanceStock = moyenneEvolutionMensuelle;
      const stockActuel = dernier.enCours;
      
      // Seuils d'alerte basés sur la capacité réelle (4.5 ETP référents).
      // Trois paliers DISTINCTS exprimés en mesures/référent :
      const seuilOptimal = 21 * 4.5;   // 94.5  → rythme optimal visé (21/référent)
      const seuilSurcharge = 23 * 4.5; // 103.5 → début de surcharge (23/référent)
      const seuilCritique = 25 * 4.5;  // 112.5 → capacité maximale (25/référent)
      
      // Prédiction : à quel moment atteindrons-nous le seuil ?
      let alertes = [];
      
      if (tauxCroissanceStock > 1.5) { // Croissance de plus de 1.5 mesures/mois
        const moisAvantCritique = Math.ceil((seuilCritique - stockActuel) / tauxCroissanceStock);
        const moisAvantSurcharge = Math.ceil((seuilSurcharge - stockActuel) / tauxCroissanceStock);
        
        if (stockActuel >= seuilCritique) {
          alertes.push({
            type: 'danger',
            titre: '🚨 Capacité maximale atteinte',
            message: `Le stock de ${stockActuel} mesures atteint/dépasse la capacité maximale (${seuilCritique} mesures pour 4.5 ETP). Situation critique nécessitant une réorganisation immédiate ou un renfort temporaire.`,
            urgence: 'immediate'
          });
        } else if (moisAvantCritique <= 6 && moisAvantCritique > 0) {
          alertes.push({
            type: 'warning',
            titre: '⚠️ Alerte prédictive - Capacité',
            message: `Au rythme actuel (+${Math.round(tauxCroissanceStock*10)/10} mesures/mois), la capacité maximale (${seuilCritique} mesures) sera atteinte dans ${moisAvantCritique} mois. Anticiper la répartition ou l'organisation du travail.`,
            urgence: 'planification'
          });
        } else if (moisAvantSurcharge <= 3 && moisAvantSurcharge > 0) {
          alertes.push({
            type: 'info',
            titre: '📈 Surveillance nécessaire',
            message: `Le stock augmente de ${Math.round(tauxCroissanceStock*10)/10} mesures/mois. Le seuil de surcharge (${seuilSurcharge} mesures) sera atteint dans ${moisAvantSurcharge} mois si cette tendance se maintient.`,
            urgence: 'surveillance'
          });
        }
      } else if (tauxCroissanceStock < -1) { // Décroissance
        if (stockActuel <= seuilOptimal) {
          alertes.push({
            type: 'success',
            titre: '✅ Situation optimale',
            message: `Excellent ! Le stock de ${stockActuel} mesures est dans la zone optimale (≤${seuilOptimal} = 21 mesures/référent) et continue de diminuer (-${Math.abs(Math.round(tauxCroissanceStock * 10) / 10)} mesures/mois). Rythme de travail idéal atteint.`,
            urgence: 'positif'
          });
        } else {
          alertes.push({
            type: 'success',
            titre: '✅ Tendance positive',
            message: `Le stock diminue de ${Math.abs(Math.round(tauxCroissanceStock * 10) / 10)} mesures/mois. Vous vous rapprochez du rythme optimal (${seuilOptimal} mesures = 21/référent). Charge actuelle : ${Math.round((stockActuel / 4.5) * 10) / 10} mesures/référent.`,            
            urgence: 'positif'
          });
        }
      } else if (stockActuel > seuilSurcharge) {
        alertes.push({
          type: 'warning',
          titre: '⚠️ Surcharge persistante',
          message: `Le stock se stabilise à ${stockActuel} mesures, soit ${Math.round((stockActuel/4.5)*10)/10} mesures/référent (seuil max : 25). Situation de surcharge chronique pouvant affecter la qualité du suivi.`,
          urgence: 'chronique'
        });
      } else if (stockActuel > seuilOptimal) {
        alertes.push({
          type: 'info',
          titre: '📊 Au-dessus du rythme optimal',
          message: `Stock actuel : ${stockActuel} mesures (${Math.round((stockActuel/4.5)*10)/10}/référent). Objectif : redescendre vers ${seuilOptimal} mesures (21/référent) pour un rythme de travail optimal.`,
          urgence: 'amelioration'
        });
      }
      
      // Alerte sur la capacité de traitement
      if (evolutionCapacite < -20) {
        alertes.push({
          type: 'warning',
          titre: '⚠️ Efficacité en baisse',
          message: `La capacité de traitement a diminué de ${Math.abs(evolutionCapacite)}% sur 12 mois. L'écart entre nouvelles mesures et clôtures se creuse, risque de saturation progressive.`,
          urgence: 'operationnel'
        });
      }
      
      // Indicateur de charge par référent
      const chargeParReferent = Math.round((stockActuel / 4.5) * 10) / 10;
      if (chargeParReferent > 25) {
        alertes.push({
          type: 'info',
          titre: '📊 Charge individuelle critique',
          message: `Charge moyenne actuelle : ${chargeParReferent} mesures/référent (seuil max : 25). Nécessité de rééquilibrer la répartition entre référents.`,
          urgence: 'repartition'
        });
      } else if (chargeParReferent > 21 && chargeParReferent <= 25) {
        alertes.push({
          type: 'info',
          titre: '📊 Charge individuelle élevée',
          message: `Charge moyenne actuelle : ${chargeParReferent} mesures/référent (objectif optimal : 21). Zone acceptable mais à surveiller.`,
          urgence: 'surveillance_charge'
        });
      }
      
      // Si données insuffisantes (comme dans votre cas avec 2025 seulement)
      if (precedent && precedent.enCours === 0) {
        alertes.push({
          type: 'info',
          titre: '📊 Analyse avec données partielles',
          message: `Évaluation basée sur ${dataArray.filter(d => d.total > 0).length} mois de données. Capacité théorique : ${seuilCritique} mesures (4.5 ETP × 25 max). Objectif optimal : ${seuilOptimal} mesures (21/référent). Une analyse plus précise sera possible avec plus d'historique.`,
          urgence: 'information'
        });
      }
      
      return alertes;
    };

    return {
      data: dataArray,
      stats: {
        evolutionEnCours,
        evolutionCapacite,
        stockActuel: dernier.enCours,
        mesuresTraitees: ecartActuel
      },
      alertes: analysePredicitive()
    };
  }, [mesures]);

  // Données pour l'évolution mensuelle - basé UNIQUEMENT sur dateReception
  const evolutionData = useMemo(() => {
    const moisData: { [key: string]: { nouvelles: number, clotures: number } } = {};
    
    // Initialiser les 12 derniers mois
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      moisData[key] = { nouvelles: 0, clotures: 0 };
    }

    // Compter TOUTES les mesures par mois de réception
    mesures.forEach(mesure => {
      const dateReception = parseExcelDate(mesure.dateReception);
      if (dateReception && !isNaN(dateReception.getTime())) {
        const key = `${dateReception.getFullYear()}-${(dateReception.getMonth() + 1).toString().padStart(2, '0')}`;
        if (moisData[key] !== undefined) {
          moisData[key].nouvelles++;
        }
      }
      
      // Compter les clôtures par mois
      const dateCloture = parseExcelDate(mesure.dateCloture) || parseExcelDate(mesure.dateFinPriseEnCharge);
      if (dateCloture && !isNaN(dateCloture.getTime())) {
        const key = `${dateCloture.getFullYear()}-${(dateCloture.getMonth() + 1).toString().padStart(2, '0')}`;
        if (moisData[key] !== undefined) {
          moisData[key].clotures++;
        }
      }
    });

    return Object.keys(moisData)
      .sort()
      .map(key => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return {
          mois: date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
          nouvelles: moisData[key].nouvelles,
          clotures: moisData[key].clotures
        };
      });
  }, [mesures]);

  // Analyse des infractions
  const infractionsData = useMemo(() => {
    const infractions: { [key: string]: number } = {};
    
    mesures.forEach(mesure => {
      const infraction = normalizeInfraction(mesure.faits);
      infractions[infraction] = (infractions[infraction] || 0) + 1;
    });
    
    const total = mesures.length;
    return Object.entries(infractions)
      .map(([name, count]) => ({
        name,
        value: Math.round((count / total) * 100 * 10) / 10,
        count
      }))
      .sort((a, b) => b.count - a.count);
  }, [mesures]);

  // Performance par référent
  const referentData = useMemo(() => {
    const referentStats: { [key: string]: { total: number; reussites: number; echecs: number; enCours: number } } = {};
    
    mesures.forEach(mesure => {
      const ref = mesure.referent || 'Non assigné';
      
      if (!referentStats[ref]) {
        referentStats[ref] = { total: 0, reussites: 0, echecs: 0, enCours: 0 };
      }
      
      referentStats[ref].total++;
      
      if (!mesure.dateCloture && !mesure.dateFinPriseEnCharge) {
        referentStats[ref].enCours++;
      }
      
      if (mesure.resultatMesure) {
        if (estReussite(mesure.resultatMesure)) {
          referentStats[ref].reussites++;
        } else if (estEchec(mesure.resultatMesure)) {
          referentStats[ref].echecs++;
        }
      }
    });
    
    return Object.entries(referentStats)
      .map(([referent, stats]) => {
        const mesuresTerminees = stats.reussites + stats.echecs;
        const tauxReussite = mesuresTerminees > 0 ? 
          Math.round((stats.reussites / mesuresTerminees) * 100) : 0;
        
        return {
          referent,
          total: stats.total,
          enCours: stats.enCours,
          reussites: stats.reussites,
          echecs: stats.echecs,
          tauxReussite,
          surcharge: stats.enCours > 30
        };
      })
      .filter(ref => ref.total > 0)
      .sort((a, b) => b.enCours - a.enCours);
  }, [mesures]);

  // Alertes
  const alertes = useMemo(() => {
    const alerts = [];
    
    const referentsSurcharges = referentData.filter(r => r.surcharge);
    referentsSurcharges.forEach(ref => {
      alerts.push({
        type: 'warning',
        message: `${ref.referent} : ${ref.enCours} dossiers en cours (> 30)`,
        action: 'Répartition nécessaire'
      });
    });
    
    if (statsWithHistory.mesuresTresAnciennes.length > 0) {
      alerts.push({
        type: 'warning',
        message: `${statsWithHistory.mesuresTresAnciennes.length} mesures en cours depuis plus de ${convocConfig.tresAncienneteMois} mois`,
        action: 'Cliquer pour voir le détail',
        details: statsWithHistory.mesuresTresAnciennes.map(m => ({
          ref: m.refAEM,
          nom: m.nomPrenom,
          dateReception: parseExcelDate(m.dateReception)?.toLocaleDateString('fr-FR') || 'Inconnue',
          referent: m.referent
        }))
      });
    }

    // Mesures anciennes (> seuil, 6 mois par défaut) : miroir de la carte
    // « + 6 mois » et de la recommandation « Planifier la clôture… ». Placée ici
    // pour que l'utilisateur voie qui sont ces mesures et puisse les copier.
    if (statsWithHistory.mesuresAnciennes.length > 0) {
      alerts.push({
        type: 'info',
        message: `${statsWithHistory.mesuresAnciennes.length} mesures en cours depuis plus de ${convocConfig.ancienneteMois} mois`,
        action: 'Cliquer pour voir le détail',
        details: statsWithHistory.mesuresAnciennes.map(m => ({
          ref: m.refAEM,
          nom: m.nomPrenom,
          dateReception: parseExcelDate(m.dateReception)?.toLocaleDateString('fr-FR') || 'Inconnue',
          referent: m.referent
        }))
      });
    }

    return alerts;
  }, [referentData, statsWithHistory, convocConfig]);

  // Analyse des convocations nécessaires
  const convocationsData = useMemo(() => {
    const alertes = {
      urgent: [] as any[],
      retard: [] as any[],
      insuffisant: [] as any[]
    };
    
    const propositionsParReferent: { [referent: string]: any[] } = {};
    
    const aujourdhui = new Date();
    
    mesures.forEach(mesure => {
      // Calculer l'âge en mois
      const dateReception = parseExcelDate(mesure.dateReception);
      if (!dateReception) return;
      
      const ageEnMois = (aujourdhui.getTime() - dateReception.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      const nbRDV = mesure.nombreRencontresPR || 0;

      // RDV attendus (1 tous les N mois en moyenne, N = cadence configurable)
      const rdvAttendus = Math.max(1, Math.floor(ageEnMois / convocConfig.cadenceRDVMois));
      const retardRDV = rdvAttendus - nbRDV;
      
      // Une mesure clôturée n'a plus à être convoquée : on ne considère
      // que les mesures réellement en cours pour toutes les alertes.
      const estEnCours = !mesure.dateCloture && !mesure.dateFinPriseEnCharge;
      if (!estEnCours) return;

      const mesureInfo = {
        nom: mesure.nomPrenom,
        ref: mesure.refAEM,
        ageEnMois: Math.round(ageEnMois * 10) / 10,
        nbRDV,
        rdvAttendus,
        retardRDV,
        referent: mesure.referent || 'Non assigné',
        score: 0
      };

      // Alertes selon les critères configurables (mesures en cours uniquement)
      if (ageEnMois >= convocConfig.urgentAgeMois && nbRDV <= convocConfig.urgentMaxRDV) {
        mesureInfo.score = 100;
        alertes.urgent.push(mesureInfo);
      } else if (ageEnMois >= convocConfig.retardAgeMois && retardRDV >= convocConfig.retardMinRetardRDV) {
        mesureInfo.score = 80;
        alertes.retard.push(mesureInfo);
      } else if (ageEnMois >= convocConfig.insuffisantAgeMois && retardRDV >= convocConfig.insuffisantMinRetardRDV) {
        mesureInfo.score = 60;
        alertes.insuffisant.push(mesureInfo);
      }

      // Score pour priorisation par référent
      mesureInfo.score = (ageEnMois * 10) + (retardRDV * 20);

      if (!propositionsParReferent[mesureInfo.referent]) {
        propositionsParReferent[mesureInfo.referent] = [];
      }
      propositionsParReferent[mesureInfo.referent].push(mesureInfo);
    });
    
    // Trier et limiter à 8 par référent
    Object.keys(propositionsParReferent).forEach(referent => {
      propositionsParReferent[referent] = propositionsParReferent[referent]
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    });
    
    return {
      alertes: {
        urgent: alertes.urgent.sort((a, b) => b.ageEnMois - a.ageEnMois),
        retard: alertes.retard.sort((a, b) => b.retardRDV - a.retardRDV),
        insuffisant: alertes.insuffisant.sort((a, b) => b.ageEnMois - a.ageEnMois)
      },
      propositionsParReferent
    };
  }, [mesures, convocConfig]);

  // Détail des mesures EN COURS par référent, pour le modal ouvert au clic sur
  // le compteur « en cours » de la charge par référent. On reprend exactement la
  // définition « en cours » de referentData (dateCloture/dateFinPriseEnCharge
  // absentes) pour que la liste corresponde au nombre affiché, même quand la
  // date de réception est illisible.
  const mesuresEnCoursParReferent = useMemo(() => {
    const map: { [referent: string]: { nom: string; ref: string; dateReception: string; dateTs: number; nbRDV: number }[] } = {};
    mesures.forEach(mesure => {
      if (mesure.dateCloture || mesure.dateFinPriseEnCharge) return;
      const referent = mesure.referent || 'Non assigné';
      const d = parseExcelDate(mesure.dateReception);
      if (!map[referent]) map[referent] = [];
      map[referent].push({
        nom: mesure.nomPrenom,
        ref: mesure.refAEM,
        dateReception: d?.toLocaleDateString('fr-FR') || 'Inconnue',
        dateTs: d ? d.getTime() : 0,
        nbRDV: mesure.nombreRencontresPR || 0,
      });
    });
    // Trier par ancienneté (mesure la plus ancienne en tête).
    Object.keys(map).forEach(referent => {
      map[referent].sort((a, b) => a.dateTs - b.dateTs);
    });
    return map;
  }, [mesures]);

  // Prédictions jusqu'à fin d'année
  const predictions = useMemo(() => {
    const maintenant = new Date();
    const finAnnee = new Date(maintenant.getFullYear(), 11, 31);
    const joursRestants = Math.ceil((finAnnee.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24));
    const moisRestants = joursRestants / 30.44; // Approximation mois
    
    // Moyenne mensuelle calculée sur les mois COMPLETS uniquement.
    // Le dernier point de evolutionData correspond au mois courant, encore
    // incomplet : l'inclure sous-estime la moyenne et donc la projection.
    // On l'exclut pour fiabiliser le calcul.
    const moisComplets = evolutionData.length > 1 ? evolutionData.slice(0, -1) : evolutionData;
    const moyenneNouvelles = moisComplets.reduce((acc, d) => acc + d.nouvelles, 0) / moisComplets.length;
    const moyenneClotures = moisComplets.reduce((acc, d) => acc + d.clotures, 0) / moisComplets.length;
    const dernierMoisComplet = moisComplets[moisComplets.length - 1];

    return {
      projectionNouvelles: Math.round(moyenneNouvelles * moisRestants),
      projectionClotures: Math.round(moyenneClotures * moisRestants),
      joursRestants,
      tendanceNouvelles: dernierMoisComplet.nouvelles > moyenneNouvelles ? 'hausse' : 'baisse',
      tendanceClotures: dernierMoisComplet.clotures > moyenneClotures ? 'hausse' : 'baisse'
    };
  }, [evolutionData]);

  const colors = {
    primary: '#3b82f6',
    success: '#10b981', 
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#8b5cf6',
    gray: '#6b7280'
  };

  if (isLoading) {
    return (
      <div className={`${className} flex items-center justify-center py-8`}>
        <div className="text-center">
          <Activity className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>Calcul des statistiques...</p>
        </div>
      </div>
    );
  }

  if (mesures.length === 0) {
    return (
      <div className={`${className} text-center py-8 text-gray-500`}>
        <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Aucune donnée AIR disponible pour les statistiques.</p>
        <p className="text-sm mt-1">Importez vos données Excel pour voir le dashboard.</p>
      </div>
    );
  }

  // Helpers d'affichage des ventilations annuelles + indicateurs de tendance.
  const { anneesAffichees, parReception, parCloture, tauxCloture, anneeCourante, evolutionAnnuelle } = statsAnnuelles;
  const ventilation = (fn: (y: number) => string) => anneesAffichees.map(fn).join(' • ');

  const anneePrec = anneeCourante - 1;
  const tauxCourant = tauxCloture(anneeCourante);
  const tauxPrec = tauxCloture(anneePrec);
  const deltaTaux = (tauxCourant !== null && tauxPrec !== null) ? tauxCourant - tauxPrec : null;
  const echecsCourant = parCloture[anneeCourante]?.echecs ?? null;
  const echecsPrec = parCloture[anneePrec]?.echecs ?? null;
  const deltaEchecs = (echecsCourant !== null && echecsPrec !== null) ? echecsCourant - echecsPrec : null;

  // Liste des mesures en cours du référent sélectionné (pour le modal).
  const selectedReferentListe = selectedReferent ? (mesuresEnCoursParReferent[selectedReferent] || []) : [];

  return (
    <div className={`${className} space-y-6 mb-6`}>
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg flex items-center gap-3">
              <Activity className="h-5 w-5 text-blue-600" />
              Dashboard Statistiques AIR
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                {statsWithHistory.actuel.total} mesures
              </Badge>
            </CardTitle>
            
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  console.log('Export AIR demandé');
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Export rapport AEM
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-blue-600">{statsWithHistory.actuel.total}</div>
            <div className="text-xs text-gray-600">Total</div>
            <div className="text-xs text-gray-500 mt-1">
              {ventilation(y => `${y}: ${parReception[y] || 0}`)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-blue-500">{statsWithHistory.actuel.enCours}</div>
            <div className="text-xs text-gray-600">En cours</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div className="text-2xl font-bold text-green-600">{statsWithHistory.actuel.reussites}</div>
            <div className="text-xs text-gray-600">Réussites</div>
            <div className="text-xs text-gray-500 mt-1">
              {ventilation(y => `${y}: ${parCloture[y]?.reussites || 0}`)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Award className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-emerald-600">{stats.tauxReussite}%</div>
            <div className="text-xs text-gray-600">Taux réussite</div>
            <div className="text-xs text-gray-500 mt-1">
              {ventilation(y => { const t = tauxCloture(y); return `${y}: ${t === null ? '—' : t + '%'}`; })}
            </div>
            {deltaTaux !== null && (
              <div
                className={`text-xs mt-0.5 flex items-center justify-center gap-0.5 font-medium ${deltaTaux >= 0 ? 'text-green-600' : 'text-red-600'}`}
                title={`Évolution du taux ${anneeCourante} vs ${anneePrec}`}
              >
                {deltaTaux >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {deltaTaux >= 0 ? '+' : ''}{deltaTaux} pts / {anneePrec}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
            <div className="text-2xl font-bold text-red-600">{statsWithHistory.actuel.echecs}</div>
            <div className="text-xs text-gray-600">Échecs</div>
            <div className="text-xs text-gray-500 mt-1">
              {ventilation(y => `${y}: ${parCloture[y]?.echecs || 0}`)}
            </div>
            {deltaEchecs !== null && (
              <div
                className={`text-xs mt-0.5 flex items-center justify-center gap-0.5 font-medium ${deltaEchecs <= 0 ? 'text-green-600' : 'text-red-600'}`}
                title={`Échecs ${anneeCourante} vs ${anneePrec} (année en cours)`}
              >
                {deltaEchecs <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {deltaEchecs > 0 ? '+' : ''}{deltaEchecs} / {anneePrec}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <FileText className="h-5 w-5 text-gray-600" />
            </div>
            <div className="text-2xl font-bold text-gray-600">{statsWithHistory.actuel.cloturees}</div>
            <div className="text-xs text-gray-600">Clôturées</div>
            <div className="text-xs text-gray-500 mt-1">
              {ventilation(y => `${y}: ${parCloture[y]?.cloturees || 0}`)}
            </div>
          </CardContent>
        </Card>

        <Card 
          className={statsWithHistory.mesuresAnciennes.length > 15 ? "bg-orange-50 cursor-pointer" : ""}
          onClick={() => statsWithHistory.mesuresAnciennes.length > 0 && setShowAnciennesDetails(!showAnciennesDetails)}
        >
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <AlertTriangle className={`h-5 w-5 ${statsWithHistory.mesuresAnciennes.length > 15 ? 'text-orange-600' : 'text-gray-600'}`} />
            </div>
            <div className={`text-2xl font-bold ${statsWithHistory.mesuresAnciennes.length > 15 ? 'text-orange-600' : 'text-gray-600'}`}>
              {statsWithHistory.mesuresAnciennes.length}
            </div>
            <div className="text-xs text-gray-600">+ 6 mois</div>
            {statsWithHistory.mesuresAnciennes.length > 0 && (
              <div className="text-xs text-orange-600 mt-1">Cliquer pour détail</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Détail des mesures anciennes */}
      {showAnciennesDetails && statsWithHistory.mesuresAnciennes.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-orange-800">
                Mesures de plus de {convocConfig.ancienneteMois} mois ({statsWithHistory.mesuresAnciennes.length})
              </CardTitle>
              <CopyButton
                label="Copier la liste"
                title="Copier la liste pour la coller dans un e-mail"
                className="text-xs text-orange-700 hover:text-orange-900 px-2 py-1"
                getText={() => formatMesuresPourCopie(
                  `Mesures en cours depuis plus de ${convocConfig.ancienneteMois} mois`,
                  statsWithHistory.mesuresAnciennes.map(m => ({
                    ref: m.refAEM,
                    nom: m.nomPrenom,
                    dateReception: parseExcelDate(m.dateReception)?.toLocaleDateString('fr-FR') || 'Inconnue',
                    referent: m.referent,
                  })),
                )}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-32 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                {statsWithHistory.mesuresAnciennes.map((mesure, i) => (
                  <div key={i} className="bg-white p-2 rounded border">
                    <div className="font-medium">{mesure.refAEM}</div>
                    <div className="text-gray-600">{mesure.nomPrenom}</div>
                    <div className="text-gray-500">
                      Reçue: {parseExcelDate(mesure.dateReception)?.toLocaleDateString('fr-FR') || 'Inconnue'}
                    </div>
                    <div className="text-gray-500">Référent: {mesure.referent || 'Non assigné'}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alertes */}
      {alertes.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-orange-800">
              <AlertCircle className="h-4 w-4" />
              Alertes système ({alertes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {alertes.map((alerte, i) => (
                <div
                  key={i}
                  onClick={() => alerte.details && setShowAlerteDetails(showAlerteDetails === i ? null : i)}
                  className={`p-3 rounded-lg border ${alerte.details ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''} ${
                    alerte.type === 'error' ? 'border-red-200 bg-red-50' :
                    alerte.type === 'warning' ? 'border-orange-200 bg-orange-50' :
                    'border-blue-200 bg-blue-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`text-sm font-medium ${
                      alerte.type === 'error' ? 'text-red-800' :
                      alerte.type === 'warning' ? 'text-orange-800' :
                      'text-blue-800'
                    }`}>
                      {alerte.message}
                    </div>
                    {alerte.details && (
                      <CopyButton
                        title="Copier la liste pour la coller dans un e-mail"
                        className="shrink-0 text-gray-500 hover:text-gray-800 hover:bg-white/70 p-1"
                        getText={() => formatMesuresPourCopie(alerte.message, alerte.details)}
                      />
                    )}
                  </div>
                  <div className={`text-xs ${
                    alerte.type === 'error' ? 'text-red-600' :
                    alerte.type === 'warning' ? 'text-orange-600' :
                    'text-blue-600'
                  }`}>
                    Action: {alerte.action}
                  </div>
                  {alerte.details && showAlerteDetails === i && (
                    <div className="mt-3 max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {alerte.details.map((d: any, j: number) => (
                        <div key={j} className="bg-white p-2 rounded border text-xs">
                          <div className="font-medium">{d.ref}</div>
                          <div className="text-gray-600">{d.nom}</div>
                          <div className="text-gray-500">Reçue: {d.dateReception}</div>
                          <div className="text-gray-500">Référent: {d.referent || 'Non assigné'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Évolution annuelle du taux de réussite */}
      {evolutionAnnuelle.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-600" />
              Évolution annuelle du taux de réussite
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={evolutionAnnuelle}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="annee" fontSize={11} />
                  <YAxis yAxisId="left" fontSize={10} allowDecimals={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    fontSize={10}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'Taux de réussite' ? [`${value}%`, name] : [value, name]
                    }
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="reussites" name="Réussites" fill={colors.success} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="echecs" name="Échecs" fill={colors.error} radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="taux"
                    name="Taux de réussite"
                    stroke={colors.info}
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-gray-500 text-center mt-2">
              Barres : réussites / échecs par année de clôture • Ligne : taux de réussite (mesures décidées)
            </div>
          </CardContent>
        </Card>
      )}

      {/* Graphiques principaux */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Évolution mensuelle */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Évolution mensuelle (12 derniers mois)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={evolutionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mois" fontSize={10} />
                  <YAxis 
                    fontSize={10} 
                    domain={[0, (dataMax) => Math.ceil(dataMax * 1.1) + 5]}
                  />
                  <Tooltip />
                  <Area 
                    type="monotone" 
                    dataKey="nouvelles" 
                    stackId="1"
                    stroke={colors.primary} 
                    fill={colors.primary}
                    fillOpacity={0.6}
                    name="Nouvelles"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="clotures" 
                    stackId="2"
                    stroke={colors.success} 
                    fill={colors.success}
                    fillOpacity={0.6}
                    name="Clôtures"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            {/* Légende */}
            <div className="text-xs text-gray-600 text-center mt-2">
              <span className="inline-flex items-center gap-1 mr-4">
                <div className="w-3 h-0.5 bg-blue-500"></div>
                Nouvelles mesures
              </span>
              <span className="inline-flex items-center gap-1">
                <div className="w-3 h-0.5 bg-green-500"></div>
                Clôtures
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Types d'infractions avec tableau */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Types d'infractions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Graphique plus grand */}
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={infractionsData}
                      cx="50%"
                      cy="50%"
                      outerRadius={110}
                      dataKey="value"
                      label={({ name, value }) => `${name.split(' ')[0]} ${value}%`}
                      labelLine={false}
                      fontSize={10}
                    >
                      {infractionsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={[
                          colors.primary, colors.info, colors.warning, 
                          colors.success, colors.error, colors.gray
                        ][index % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`${value}%`, 'Pourcentage']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              
              {/* Tableau compact sans scroll */}
              <div className="flex flex-col justify-center">
                <div className="text-sm font-medium text-gray-700 mb-2">Répartition détaillée</div>
                <div className="grid grid-cols-1 gap-1">
                  {infractionsData.slice(0, 10).map((item, index) => (
                    <div key={index} className="grid grid-cols-3 gap-2 p-1 bg-gray-50 rounded text-xs items-center">
                      <div className="flex items-center gap-1">
                        <div 
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: [
                              colors.primary, colors.info, colors.warning, 
                              colors.success, colors.error, colors.gray
                            ][index % 6]
                          }}
                        />
                        <span className="font-medium truncate text-xs" title={item.name}>
                          {item.name.length > 18 ? item.name.substring(0, 18) + '...' : item.name}
                        </span>
                      </div>
                      <div className="text-center font-bold">{item.value}%</div>
                      <div className="text-right text-gray-500">({item.count})</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance référents et suivi 36 mois */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance par référent */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              Charge par référent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {referentData.slice(0, 6).map((ref, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ref.referent}</span>
                      {ref.surcharge && (
                        <Badge variant="outline" className="bg-orange-100 text-orange-800 text-xs">
                          Surcharge
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      {ref.total} total • {ref.reussites}R {ref.echecs}E • {ref.tauxReussite}%
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReferent(ref.referent)}
                    disabled={ref.enCours === 0}
                    title={ref.enCours > 0 ? 'Voir la liste des mesures en cours' : undefined}
                    className={`text-right rounded-md px-2 py-1 transition-colors ${
                      ref.enCours > 0 ? 'hover:bg-blue-50 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <div className={`text-lg font-bold ${ref.surcharge ? 'text-orange-600' : 'text-blue-600'} ${ref.enCours > 0 ? 'underline decoration-dotted underline-offset-2' : ''}`}>
                      {ref.enCours}
                    </div>
                    <div className="text-xs text-gray-500">en cours</div>
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Suivi 36 mois du stock de mesures avec statistiques et alertes prédictives */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Évolution du stock de mesures (36 mois)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="h-64 mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={suivi36MoisData.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="mois" 
                    fontSize={10}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis fontSize={10} />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      value, 
                      name === 'enCours' ? 'En cours' : 'Total cumulé'
                    ]}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="enCours" 
                    stroke={colors.warning}
                    strokeWidth={2}
                    name="En cours"
                    dot={{ r: 3 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    stroke={colors.primary}
                    strokeWidth={2}
                    name="Total cumulé"
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            {/* Légende */}
            <div className="text-xs text-gray-600 text-center mb-3">
              <span className="inline-flex items-center gap-1 mr-4">
                <div className="w-3 h-0.5 bg-orange-500"></div>
                En cours
              </span>
              <span className="inline-flex items-center gap-1">
                <div className="w-3 h-0.5 bg-blue-500"></div>
                Total cumulé
              </span>
            </div>

            {/* Alertes prédictives */}
            {suivi36MoisData.alertes.length > 0 && (
              <div className="mb-3 space-y-2">
                {suivi36MoisData.alertes.map((alerte, i) => (
                  <div key={i} className={`p-3 rounded-lg border text-sm ${
                    alerte.type === 'danger' ? 'border-red-200 bg-red-50' :
                    alerte.type === 'warning' ? 'border-orange-200 bg-orange-50' :
                    alerte.type === 'success' ? 'border-green-200 bg-green-50' :
                    'border-blue-200 bg-blue-50'
                  }`}>
                    <div className={`font-medium mb-1 ${
                      alerte.type === 'danger' ? 'text-red-800' :
                      alerte.type === 'warning' ? 'text-orange-800' :
                      alerte.type === 'success' ? 'text-green-800' :
                      'text-blue-800'
                    }`}>
                      {alerte.titre}
                    </div>
                    <div className={`text-xs ${
                      alerte.type === 'danger' ? 'text-red-700' :
                      alerte.type === 'warning' ? 'text-orange-700' :
                      alerte.type === 'success' ? 'text-green-700' :
                      'text-blue-700'
                    }`}>
                      {alerte.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Statistiques d'évolution */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-600 mb-1">Évolution stock (12 mois)</div>
                <div className={`text-lg font-bold ${
                  suivi36MoisData.stats.evolutionEnCours > 0 ? 'text-red-600' : 
                  suivi36MoisData.stats.evolutionEnCours < 0 ? 'text-green-600' : 'text-gray-600'
                }`}>
                  {suivi36MoisData.stats.evolutionEnCours > 0 ? '+' : ''}{suivi36MoisData.stats.evolutionEnCours}%
                </div>
                <div className="text-xs text-gray-500">
                  {suivi36MoisData.stats.stockActuel} mesures en cours
                </div>
              </div>
              
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-600 mb-1">Capacité traitement (12 mois)</div>
                <div className={`text-lg font-bold ${
                  suivi36MoisData.stats.evolutionCapacite > 0 ? 'text-green-600' : 
                  suivi36MoisData.stats.evolutionCapacite < 0 ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {suivi36MoisData.stats.evolutionCapacite > 0 ? '+' : ''}{suivi36MoisData.stats.evolutionCapacite}%
                </div>
                <div className="text-xs text-gray-500">
                  {suivi36MoisData.stats.mesuresTraitees} mesures traitées
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Convocations */}
      <div className="grid grid-cols-1 gap-6">
        {/* Alertes convocations avec liste complète */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Alertes Convocations Procureur
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Urgent */}
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="font-medium text-red-800 mb-2">
                  🔴 Urgent à convoquer ({convocationsData.alertes.urgent.length})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {convocationsData.alertes.urgent.map((mesure, i) => (
                    <div key={i} className="text-xs text-red-700 p-2 bg-white rounded border">
                      <div className="font-medium">{mesure.nom}</div>
                      <div className="text-red-600">Réf: {mesure.ref}</div>
                      <div>{mesure.ageEnMois} mois • {mesure.nbRDV} RDV • {mesure.referent}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Retard */}
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="font-medium text-orange-800 mb-2">
                  🟠 Retard probable ({convocationsData.alertes.retard.length})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {convocationsData.alertes.retard.map((mesure, i) => (
                    <div key={i} className="text-xs text-orange-700 p-2 bg-white rounded border">
                      <div className="font-medium">{mesure.nom}</div>
                      <div className="text-orange-600">Réf: {mesure.ref}</div>
                      <div>{mesure.ageEnMois} mois • {mesure.nbRDV} RDV • {mesure.referent}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Insuffisant */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="font-medium text-yellow-800 mb-2">
                  🟡 Suivi insuffisant ({convocationsData.alertes.insuffisant.length})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {convocationsData.alertes.insuffisant.map((mesure, i) => (
                    <div key={i} className="text-xs text-yellow-700 p-2 bg-white rounded border">
                      <div className="font-medium">{mesure.nom}</div>
                      <div className="text-yellow-600">Réf: {mesure.ref}</div>
                      <div>{mesure.ageEnMois} mois • {mesure.nbRDV} RDV • {mesure.referent}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Propositions par référent - masquée par défaut */}
        {showPropositionsDetails && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Propositions prochaines convocations (Top 8 par référent)
                </CardTitle>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowPropositionsDetails(false)}
                >
                  <ChevronUp className="h-4 w-4" />
                  Masquer
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Object.entries(convocationsData.propositionsParReferent)
                  .filter(([referent, propositions]) => propositions.length > 0)
                  .map(([referent, propositions]) => (
                  <div key={referent} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-medium text-gray-800">
                        {referent} ({propositions.length} propositions)
                      </div>
                      <CopyButton
                        label="Copier"
                        title={`Copier les propositions de ${referent}`}
                        className="text-xs text-gray-500 hover:text-gray-800 hover:bg-white px-2 py-1"
                        getText={() =>
                          `Propositions de convocations — ${referent} (${propositions.length})\n\n` +
                          propositions
                            .map(m => `- ${m.nom || ''} (${m.ref || ''}) — ${m.ageEnMois} mois — ${m.nbRDV}/${m.rdvAttendus} RDV`)
                            .join('\n')
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      {propositions.map((mesure, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-white rounded text-xs">
                          <div>
                            <div className="font-medium">{mesure.nom}</div>
                            <div className="text-gray-600">{mesure.ref}</div>
                          </div>
                          <div className="text-right">
                            <div className={`font-medium ${
                              mesure.retardRDV >= 3 ? 'text-red-600' : 
                              mesure.retardRDV >= 1 ? 'text-orange-600' : 
                              'text-gray-600'
                            }`}>
                              {mesure.ageEnMois} mois
                            </div>
                            <div className="text-gray-500">
                              {mesure.nbRDV}/{mesure.rdvAttendus} RDV
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bouton pour afficher les propositions */}
        {!showPropositionsDetails && (
          <Card>
            <CardContent className="p-4 text-center">
              <Button 
                variant="outline" 
                onClick={() => setShowPropositionsDetails(true)}
                className="flex items-center gap-2"
              >
                <ChevronDown className="h-4 w-4" />
                Voir les propositions de convocations par référent
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Prédictions et recommandations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prédictions jusqu'à fin d'année */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Projections jusqu'au 31 décembre {new Date().getFullYear()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-blue-800 font-medium">Nouvelles mesures</span>
                  <Badge className={`${predictions.tendanceNouvelles === 'hausse' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                    {predictions.tendanceNouvelles === 'hausse' ? '↗' : '↘'} Tendance
                  </Badge>
                </div>
                <div className="text-2xl font-bold text-blue-700 mt-1">
                  ~{predictions.projectionNouvelles}
                </div>
                <div className="text-sm text-blue-600">
                  Projection d'ici fin d'année ({predictions.joursRestants} jours) - Moyenne 12 mois
                </div>
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-green-800 font-medium">Clôtures prévues</span>
                  <Badge className={`${predictions.tendanceClotures === 'hausse' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                    {predictions.tendanceClotures === 'hausse' ? '↗' : '↘'} Tendance
                  </Badge>
                </div>
                <div className="text-2xl font-bold text-green-700 mt-1">
                  ~{predictions.projectionClotures}
                </div>
                <div className="text-sm text-green-600">
                  Si le rythme actuel se maintient - Moyenne 12 mois
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recommandations */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Recommandations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {referentData.filter(r => r.surcharge).length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded">
                  <div className="font-medium text-orange-800">Répartition de charge</div>
                  <div className="text-sm text-orange-700 mt-1">
                    {referentData.filter(r => r.surcharge).length} référent(s) surchargé(s). 
                    Redistribuer les nouveaux dossiers.
                  </div>
                </div>
              )}

              {stats.anciennes > 15 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <div className="font-medium text-yellow-800">Mesures anciennes</div>
                  <div className="text-sm text-yellow-700 mt-1">
                    Planifier la clôture de {stats.anciennes} mesures de plus de 6 mois.
                  </div>
                </div>
              )}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <div className="font-medium text-blue-800">Performance globale</div>
                <div className="text-sm text-blue-700 mt-1">
                  Taux de réussite: {stats.tauxReussite}% • 
                  Moyenne entretiens PR: {stats.moyenneEntretiensPR}/mesure
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Résumé données */}
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-gray-600 text-center">
            <strong>Données analysées:</strong> {stats.total} mesures AIR • 
            <strong> En cours:</strong> {stats.enCours} • 
            <strong> Clôturées:</strong> {stats.cloturees} • 
            <strong> Dernière mise à jour:</strong> {new Date().toLocaleDateString('fr-FR', { 
              weekday: 'long', 
              day: 'numeric', 
              month: 'long', 
              year: 'numeric' 
            })}
          </div>
        </CardContent>
      </Card>

      {/* Modal : détail des mesures en cours d'un référent (clic sur le compteur
          « en cours » de la charge par référent) */}
      {selectedReferent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedReferent(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-4 w-4 text-blue-600 shrink-0" />
                <h3 className="font-semibold text-gray-800 truncate">
                  Mesures en cours — {selectedReferent}
                  <span className="ml-2 text-sm font-normal text-gray-500">({selectedReferentListe.length})</span>
                </h3>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <CopyButton
                  label="Copier la liste"
                  title="Copier la liste pour la coller dans un e-mail"
                  className="text-xs text-blue-700 hover:text-blue-900 hover:bg-blue-50 px-2 py-1"
                  getText={() =>
                    `Mesures en cours — ${selectedReferent} (${selectedReferentListe.length})\n\n` +
                    selectedReferentListe
                      .map(m => `- ${m.nom || ''} (${m.ref || ''}) — Début : ${m.dateReception} — RDV devant PR : ${m.nbRDV}`)
                      .join('\n')
                  }
                />
                <button
                  type="button"
                  onClick={() => setSelectedReferent(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-4">
              {selectedReferentListe.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-6">Aucune mesure en cours.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-1.5 pr-2 font-medium">Nom / Prénom</th>
                      <th className="py-1.5 px-2 font-medium">Réf. AEM</th>
                      <th className="py-1.5 px-2 font-medium">Date début</th>
                      <th className="py-1.5 pl-2 font-medium text-right">RDV devant PR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedReferentListe.map((m, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-1.5 pr-2 font-medium text-gray-800">{m.nom || '—'}</td>
                        <td className="py-1.5 px-2 font-mono text-xs text-gray-600">{m.ref}</td>
                        <td className="py-1.5 px-2 text-gray-600">{m.dateReception}</td>
                        <td className="py-1.5 pl-2 text-right">
                          <Badge variant="secondary" className="text-xs">{m.nbRDV}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};