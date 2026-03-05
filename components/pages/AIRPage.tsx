// components/pages/AIRPage.tsx - Version mise à jour avec tri par colonnes

import React, { useState, useMemo } from 'react';
import { AIRImportData, AIRStatus } from '@/types/interfaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { FileUp, Search, Users, TrendingUp, Clock, Target, Calendar, Trash2, BarChart3, Plus, Minus, Edit3, Building2, ChevronUp, ChevronDown } from 'lucide-react';
import { AIRImportModal } from '@/components/modals/AIRImportModal';
import { GreffeImportModal } from '@/components/modals/GreffeImportModal';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { AIRDashboardIntegrated } from '@/components/AIRDashboardIntegrated';

interface AIRPageProps {
  mesures?: AIRImportData[];
  isLoading?: boolean;
  onUpdateMesure?: (refAEM: string, updates: Partial<AIRImportData>) => void;
  onDeleteMesure?: (refAEM: string) => void;
  onAddMesure?: (mesure: Omit<AIRImportData, 'refAEM'> & { refAEM: string }) => void;
  onImportMesures?: (data: AIRImportData[], strategy: 'merge' | 'replace') => void;
  onDeleteAllMesures?: () => void;
}

type SortField = 'dateReception' | 'dateCloture' | 'nomPrenom' | 'referent';
type SortDirection = 'asc' | 'desc';

// Composant pour l'en-tête de colonne triable
const SortableHeader = ({ 
  field, 
  currentField, 
  direction, 
  onSort, 
  children 
}: { 
  field: SortField;
  currentField: SortField | null;
  direction: SortDirection;
  onSort: (field: SortField) => void;
  children: React.ReactNode;
}) => {
  return (
    <div 
      className="flex items-center gap-1 cursor-pointer hover:text-blue-600 select-none"
      onClick={() => onSort(field)}
    >
      {children}
      {currentField === field && (
        direction === 'asc' ? 
          <ChevronUp className="h-3 w-3" /> : 
          <ChevronDown className="h-3 w-3" />
      )}
    </div>
  );
};

// Composant pour l'édition des rencontres PR
const RencontresPREditor = ({ 
  value, 
  onUpdate 
}: { 
  value: number; 
  onUpdate: (newValue: number) => void;
}) => {
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(value + 1);
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (value > 0) {
      onUpdate(value - 1);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 hover:bg-red-100"
        onClick={handleDecrement}
        disabled={value <= 0}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Badge variant="secondary" className="text-xs min-w-[24px] text-center">
        {value || 0}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 hover:bg-green-100"
        onClick={handleIncrement}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
};

// Composant générique pour l'édition de texte
const TextEditor = ({ 
  value, 
  onUpdate,
  placeholder = "",
  className = "",
  maxLength,
  pattern,
  type = "text"
}: { 
  value?: string; 
  onUpdate: (newValue: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  pattern?: string;
  type?: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTempValue(value || '');
    setIsEditing(true);
  };

  const handleSave = () => {
    onUpdate(tempValue.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type={type}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`h-6 text-xs ${className}`}
          placeholder={placeholder}
          maxLength={maxLength}
          pattern={pattern}
          autoFocus
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-green-600"
          onClick={handleSave}
        >
          ✓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-red-600"
          onClick={handleCancel}
        >
          ✗
        </Button>
      </div>
    );
  }

  return (
    <div 
      className="cursor-pointer hover:bg-gray-50 p-1 rounded group relative text-xs"
      onClick={handleEdit}
    >
      {value || <span className="text-gray-400">{placeholder}</span>}
      <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 absolute -top-1 -right-1" />
    </div>
  );
};

// Composant pour l'édition de texte long (avec textarea)
const TextAreaEditor = ({ 
  value, 
  onUpdate,
  placeholder = "",
  maxLength = 500
}: { 
  value?: string; 
  onUpdate: (newValue: string) => void;
  placeholder?: string;
  maxLength?: number;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTempValue(value || '');
    setIsEditing(true);
  };

  const handleSave = () => {
    onUpdate(tempValue.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full h-20 text-xs border rounded p-1 resize-none"
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus
        />
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-green-600"
            onClick={handleSave}
          >
            ✓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-red-600"
            onClick={handleCancel}
          >
            ✗
          </Button>
          <span className="text-xs text-gray-400 ml-auto">
            Ctrl+Enter pour sauver
          </span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="cursor-pointer hover:bg-gray-50 p-1 rounded group relative text-xs"
      onClick={handleEdit}
    >
      <div className="max-w-xs truncate" title={value}>
        {value || <span className="text-gray-400">{placeholder}</span>}
      </div>
      <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 absolute -top-1 -right-1" />
    </div>
  );
};

// Composant pour l'édition de select
const SelectEditor = ({ 
  value, 
  onUpdate,
  options,
  placeholder = "Non défini"
}: { 
  value?: string; 
  onUpdate: (newValue: string) => void;
  options: { value: string; label: string; color?: string }[];
  placeholder?: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const currentOption = options.find(opt => opt.value === (value || ''));

  const handleSelect = (newValue: string) => {
    onUpdate(newValue);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="relative">
        <div className="absolute top-0 left-0 z-10 bg-white border rounded shadow-lg p-2 min-w-[120px] max-h-40 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              className="block w-full text-left px-2 py-1 hover:bg-gray-100 rounded text-xs"
              onClick={() => handleSelect(option.value)}
            >
              {option.color ? (
                <Badge className={option.color}>
                  {option.label}
                </Badge>
              ) : (
                option.label
              )}
            </button>
          ))}
          <button
            className="block w-full text-left px-2 py-1 hover:bg-gray-100 rounded text-xs mt-1 border-t"
            onClick={() => setIsEditing(false)}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="cursor-pointer hover:bg-gray-50 p-1 rounded group relative"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      {currentOption ? (
        currentOption.color ? (
          <Badge className={currentOption.color}>
            {currentOption.label}
          </Badge>
        ) : (
          <span className="text-xs">{currentOption.label}</span>
        )
      ) : (
        <span className="text-gray-400 text-xs">{placeholder}</span>
      )}
      <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 absolute -top-1 -right-1" />
    </div>
  );
};

// Composant pour l'édition du résultat
const ResultatEditor = ({ 
  value, 
  onUpdate 
}: { 
  value?: string; 
  onUpdate: (newValue: string, shouldClose: boolean) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const options = [
    { value: '', label: 'Non défini', color: 'bg-gray-100 text-gray-800' },
    { value: 'Réussite', label: 'Réussite', color: 'bg-green-100 text-green-800' },
    { value: 'Échec', label: 'Échec', color: 'bg-red-100 text-red-800' }
  ];

  const currentOption = options.find(opt => opt.value === (value || '')) || options[0];

  const handleSelect = (newValue: string) => {
    const shouldClose = newValue !== '';
    onUpdate(newValue, shouldClose);
    setIsEditing(false);
  };

  const getResultatColor = (resultat?: string) => {
    const option = options.find(opt => opt.value === (resultat || ''));
    return option?.color || 'bg-gray-100 text-gray-800';
  };

  if (isEditing) {
    return (
      <div className="relative">
        <div className="absolute top-0 left-0 z-10 bg-white border rounded shadow-lg p-2 min-w-[120px]">
          {options.map((option) => (
            <button
              key={option.value}
              className="block w-full text-left px-2 py-1 hover:bg-gray-100 rounded text-xs"
              onClick={() => handleSelect(option.value)}
            >
              <Badge className={option.color}>
                {option.label}
              </Badge>
            </button>
          ))}
          <button
            className="block w-full text-left px-2 py-1 hover:bg-gray-100 rounded text-xs mt-1 border-t"
            onClick={() => setIsEditing(false)}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="cursor-pointer hover:bg-gray-50 p-1 rounded group relative"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      {value ? (
        <Badge className={getResultatColor(value)}>
          {value}
        </Badge>
      ) : (
        <span className="text-gray-400 text-xs">Non défini</span>
      )}
      <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 absolute -top-1 -right-1" />
    </div>
  );
};

// Composant pour l'édition de la date de clôture
const DateCloureEditor = ({ 
  value, 
  onUpdate 
}: { 
  value?: string | number; 
  onUpdate: (newValue: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');

  const formatDateForInput = (dateValue?: string | number) => {
    if (!dateValue) return '';
    
    if (typeof dateValue === 'number') {
      // Date Excel
      const excelEpoch = new Date(1900, 0, 1);
      const date = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
      return date.toISOString().split('T')[0];
    }
    
    // Essayer de parser la date string
    try {
      const parts = dateValue.toString().split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        return `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    } catch {
      // Si parsing échoue, retourner vide
    }
    
    return '';
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTempValue(formatDateForInput(value));
    setIsEditing(true);
  };

  const handleSave = () => {
    if (tempValue) {
      // Convertir la date au format dd/mm/yyyy
      const date = new Date(tempValue);
      const formatted = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
      onUpdate(formatted);
    } else {
      onUpdate('');
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-32 h-6 text-xs"
          autoFocus
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-green-600"
          onClick={handleSave}
        >
          ✓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-red-600"
          onClick={handleCancel}
        >
          ✗
        </Button>
      </div>
    );
  };

  return (
    <div 
      className="cursor-pointer hover:bg-gray-50 p-1 rounded group relative text-xs"
      onClick={handleEdit}
    >
      {formatDateDDMMYYYY(value)}
      <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 absolute -top-1 -right-1" />
    </div>
  );
};

// Fonction pour formater les dates au format dd/mm/yyyy
const formatDateDDMMYYYY = (dateStr?: string | number) => {
  if (!dateStr) return '-';
  
  if (typeof dateStr === 'number') {
    // Date Excel
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (dateStr - 1) * 24 * 60 * 60 * 1000);
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
  }
  
  // Si c'est déjà au format dd/mm/yyyy, retourner tel quel
  if (typeof dateStr === 'string' && dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    return dateStr;
  }
  
  // Essayer de parser d'autres formats
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
    }
  } catch {
    // Si parsing échoue, retourner la valeur originale
  }
  
  return dateStr.toString();
};

// Fonction pour convertir une date en timestamp pour le tri
const getDateTimestamp = (dateStr?: string | number) => {
  if (!dateStr) return 0;
  
  if (typeof dateStr === 'number') {
    // Date Excel
    const excelEpoch = new Date(1900, 0, 1);
    return new Date(excelEpoch.getTime() + (dateStr - 1) * 24 * 60 * 60 * 1000).getTime();
  }
  
  if (typeof dateStr === 'string') {
    // Format dd/mm/yyyy
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts.map(Number);
      return new Date(year, month - 1, day).getTime();
    }
    
    // Essayer de parser directement
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  
  return 0;
};

export const AIRPage = ({
  mesures = [],
  isLoading = false,
  onUpdateMesure = () => {},
  onDeleteMesure = () => {},
  onAddMesure = () => {},
  onImportMesures = () => {},
  onDeleteAllMesures = () => {}
}: AIRPageProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | 'en_cours' | 'clotures'>('tous');
  const [referentFilter, setReferentFilter] = useState<string>('');
  const [secteurFilter, setSecteurFilter] = useState<string>('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGreffeModal, setShowGreffeModal] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [showFinalDeleteDialog, setShowFinalDeleteDialog] = useState(false);
  const [showDashboard, setShowDashboard] = useState(mesures.length > 0);
  
  // États pour le tri
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Fonction de tri
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Statistiques basées sur les vraies données Excel
  const stats = useMemo(() => {
    const total = mesures.length;
    const enCours = mesures.filter(m => !m.dateCloture && !m.dateFinPriseEnCharge).length;
    const clotures = mesures.filter(m => m.dateCloture || m.dateFinPriseEnCharge).length;
    const reussites = mesures.filter(m => m.resultatMesure?.toLowerCase().includes('réussite')).length;
    const echecs = mesures.filter(m => m.resultatMesure?.toLowerCase().includes('échec') || m.resultatMesure?.toLowerCase().includes('echec')).length;
    
    const nouvelles2025 = mesures.filter(m => {
      return m.refAEM && m.refAEM.includes('25/');
    }).length;
    
    const clotures2025 = mesures.filter(m => {
      if (!m.dateCloture) return false;
      if (typeof m.dateCloture === 'number' && m.dateCloture > 45000) return true;
      try {
        const parts = m.dateCloture.toString().split('/');
        if (parts.length !== 3) return false;
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        return year === 2025;
      } catch {
        return false;
      }
    }).length;
    
    const avecNumeroParquet = mesures.filter(m => m.numeroParquet && m.numeroParquet.trim() !== '').length;
    const sourceGreffe = mesures.filter(m => m.sourceGreffe).length;
    
    return {
      total,
      enCours,
      clotures,
      reussites,
      echecs,
      nouvelles2025,
      clotures2025,
      avecNumeroParquet,
      sourceGreffe
    };
  }, [mesures]);

  // Listes d'options pour les selects
  const secteurOptions = useMemo(() => [
    { value: '', label: 'Non défini' },
    { value: 'Amiens', label: 'Amiens' },
    { value: 'Abbeville', label: 'Abbeville' },
    { value: 'Montdidier', label: 'Montdidier' },
    { value: 'Péronne', label: 'Péronne' },
    { value: 'Doullens', label: 'Doullens' },
    { value: 'Albert', label: 'Albert' },
    { value: 'Autres', label: 'Autres' }
  ], []);

  const referentOptions = useMemo(() => {
    const refs = new Set(mesures.map(m => m.referent).filter(Boolean));
    const options = [{ value: '', label: 'Non défini' }];
    Array.from(refs).sort().forEach(ref => {
      options.push({ value: ref, label: ref });
    });
    return options;
  }, [mesures]);

  const natureFinOptions = useMemo(() => [
    { value: '', label: 'Non défini' },
    { value: 'Mesure réalisée', label: 'Mesure réalisée' },
    { value: 'Abandon de la mesure', label: 'Abandon de la mesure' },
    { value: 'Incident de mesure', label: 'Incident de mesure' },
    { value: 'Révocation', label: 'Révocation' },
    { value: 'Décès', label: 'Décès' },
    { value: 'Autres', label: 'Autres' }
  ], []);

  // Listes pour les filtres
  const referents = useMemo(() => {
    const refs = new Set(mesures.map(m => m.referent).filter(Boolean));
    return Array.from(refs).sort();
  }, [mesures]);

  const secteurs = useMemo(() => {
    const sects = new Set(mesures.map(m => m.secteurGeographique).filter(Boolean));
    return Array.from(sects).sort();
  }, [mesures]);

  // Filtrage et tri
  const filteredAndSortedMesures = useMemo(() => {
    let filtered = mesures.filter(mesure => {
      if (statusFilter === 'en_cours' && (mesure.dateCloture || mesure.dateFinPriseEnCharge)) return false;
      if (statusFilter === 'clotures' && !mesure.dateCloture && !mesure.dateFinPriseEnCharge) return false;
      if (referentFilter && mesure.referent !== referentFilter) return false;
      if (secteurFilter && mesure.secteurGeographique !== secteurFilter) return false;
      
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          mesure.nomPrenom?.toLowerCase().includes(search) ||
          mesure.refAEM?.toLowerCase().includes(search) ||
          mesure.numeroParquet?.toLowerCase().includes(search) ||
          mesure.faits?.toLowerCase().includes(search) ||
          mesure.referent?.toLowerCase().includes(search)
        );
      }
      
      return true;
    });

    // Appliquer le tri
    if (sortField) {
      filtered.sort((a, b) => {
        let valueA: any;
        let valueB: any;

        switch (sortField) {
          case 'dateReception':
            valueA = getDateTimestamp(a.dateReception);
            valueB = getDateTimestamp(b.dateReception);
            break;
          case 'dateCloture':
            valueA = getDateTimestamp(a.dateCloture);
            valueB = getDateTimestamp(b.dateCloture);
            break;
          case 'nomPrenom':
            valueA = (a.nomPrenom || '').toLowerCase();
            valueB = (b.nomPrenom || '').toLowerCase();
            break;
          case 'referent':
            valueA = (a.referent || '').toLowerCase();
            valueB = (b.referent || '').toLowerCase();
            break;
          default:
            return 0;
        }

        if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
        if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [mesures, statusFilter, referentFilter, secteurFilter, searchTerm, sortField, sortDirection]);

  // Gestionnaires pour l'import greffe
  const handleGreffeUpdates = (updates: { mesure: AIRImportData, numeroParquet: string }[]) => {
    updates.forEach(({ mesure, numeroParquet }) => {
      onUpdateMesure(mesure.refAEM, { numeroParquet });
    });
  };

  const handleGreffeNewMesures = (newMesures: (Omit<AIRImportData, 'refAEM'> & { refAEM: string })[]) => {
    newMesures.forEach(mesure => {
      onAddMesure(mesure);
    });
  };

  // Gestionnaires d'événements pour toutes les modifications
  const handleUpdateField = (refAEM: string, field: keyof AIRImportData, value: any) => {
    onUpdateMesure(refAEM, { [field]: value });
  };

  const handleUpdateRencontresPR = (refAEM: string, newValue: number) => {
    onUpdateMesure(refAEM, { nombreRencontresPR: newValue });
  };

  const handleUpdateResultat = (refAEM: string, newValue: string, shouldClose: boolean) => {
    const updates: Partial<AIRImportData> = { resultatMesure: newValue };
    
    // Si on passe à un résultat défini et qu'il n'y a pas de date de clôture
    if (shouldClose) {
      const mesure = mesures.find(m => m.refAEM === refAEM);
      if (mesure && !mesure.dateCloture) {
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`;
        updates.dateCloture = dateStr;
      }
    }
    
    onUpdateMesure(refAEM, updates);
  };

  const handleUpdateDateCloture = (refAEM: string, newValue: string) => {
    onUpdateMesure(refAEM, { dateCloture: newValue });
  };

  // Fonctions utilitaires
  const getResultatColor = (resultat?: string) => {
    if (!resultat) return 'bg-gray-100 text-gray-800';
    const lower = resultat.toLowerCase();
    if (lower.includes('réussite')) return 'bg-green-100 text-green-800';
    if (lower.includes('échec') || lower.includes('echec')) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  const getStatutText = (mesure: AIRImportData) => {
    if (mesure.dateCloture || mesure.dateFinPriseEnCharge) {
      return 'Clôturé';
    }
    return 'En cours';
  };

  const getStatutColor = (mesure: AIRImportData) => {
    if (mesure.dateCloture || mesure.dateFinPriseEnCharge) {
      return 'bg-gray-100 text-gray-800';
    }
    return 'bg-blue-100 text-blue-800';
  };

  const getRowClassName = (mesure: AIRImportData) => {
    if (mesure.sourceGreffe) {
      return 'bg-yellow-50 hover:bg-yellow-100';
    }
    return 'hover:bg-gray-50';
  };

  const handleDeleteAll = () => {
    setShowDeleteAllDialog(true);
  };

  const handleConfirmFirstDelete = () => {
    setShowDeleteAllDialog(false);
    setShowFinalDeleteDialog(true);
  };

  const handleFinalDeleteAll = () => {
    onDeleteAllMesures();
    setShowFinalDeleteDialog(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>Chargement des mesures AIR...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dashboard statistiques intégré */}
      {mesures.length > 0 && (
        <AIRDashboardIntegrated 
          mesures={mesures} 
          isLoading={isLoading}
        />
      )}

      {/* Statistiques existantes (version compacte si dashboard affiché) */}
      {!showDashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4" />
                Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                En cours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.enCours}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-600" />
                Clôturés
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{stats.clotures}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                Réussites
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.reussites}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-red-600" />
                Échecs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.echecs}</div>
            </CardContent>
          </Card>

          <Card className="bg-green-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-800">
                Nouvelles 2025
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-800">{stats.nouvelles2025}</div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-800">
                Avec N° Parquet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-800">{stats.avecNumeroParquet}</div>
            </CardContent>
          </Card>

          <Card className="bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-800">
                Source Greffe
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-800">{stats.sourceGreffe}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tableau principal */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>
              Mesures A.I.R. ({filteredAndSortedMesures.length} sur {stats.total})
              {mesures.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-3"
                  onClick={() => setShowDashboard(!showDashboard)}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  {showDashboard ? 'Masquer stats' : 'Voir stats'}
                </Button>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImportModal(true)}
              >
                <FileUp className="mr-2 h-4 w-4" />
                Importer AEM
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGreffeModal(true)}
                className="bg-blue-50 hover:bg-blue-100 border-blue-200"
              >
                <Building2 className="mr-2 h-4 w-4" />
                Importer Greffe
              </Button>
              
              {mesures.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 px-2"
                  onClick={handleDeleteAll}
                  title="Supprimer toutes les mesures AIR"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Filtres */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-gray-500" />
              <Input
                placeholder="Rechercher nom, référence, N° parquet, faits..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
              />
            </div>

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'tous' | 'en_cours' | 'clotures')}
              className="w-32"
            >
              <option value="tous">Tous</option>
              <option value="en_cours">En cours</option>
              <option value="clotures">Clôturés</option>
            </Select>

            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <Select
                value={referentFilter}
                onChange={(e) => setReferentFilter(e.target.value)}
                className="w-32"
              >
                <option value="">Tous référents</option>
                {referents.map(ref => (
                  <option key={ref} value={ref}>{ref}</option>
                ))}
              </Select>
            </div>

            <Select
              value={secteurFilter}
              onChange={(e) => setSecteurFilter(e.target.value)}
              className="w-40"
            >
              <option value="">Tous secteurs</option>
              {secteurs.map(sect => (
                <option key={sect} value={sect}>{sect}</option>
              ))}
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {filteredAndSortedMesures.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>Aucune mesure AIR trouvée.</p>
              <p className="text-sm mt-2">Utilisez les boutons "Importer AEM" ou "Importer Greffe" pour charger vos données.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Réf. AEM</TableHead>
                    <TableHead className="w-32">N° Parquet</TableHead>
                    <TableHead className="w-40">
                      <SortableHeader
                        field="nomPrenom"
                        currentField={sortField}
                        direction={sortDirection}
                        onSort={handleSort}
                      >
                        Nom / Prénom
                      </SortableHeader>
                    </TableHead>
                    <TableHead className="w-40">Faits</TableHead>
                    <TableHead className="w-24">
                      <SortableHeader
                        field="dateReception"
                        currentField={sortField}
                        direction={sortDirection}
                        onSort={handleSort}
                      >
                        Date réception
                      </SortableHeader>
                    </TableHead>
                    <TableHead className="w-36">Secteur géographique</TableHead>
                    <TableHead className="w-24">
                      <SortableHeader
                        field="referent"
                        currentField={sortField}
                        direction={sortDirection}
                        onSort={handleSort}
                      >
                        En charge de
                      </SortableHeader>
                    </TableHead>
                    <TableHead className="w-20">Entretiens AIR</TableHead>
                    <TableHead className="w-32">Rencontres PR</TableHead>
                    <TableHead className="w-20">Carences</TableHead>
                    <TableHead className="w-36">Nature fin AIR</TableHead>
                    <TableHead className="w-32">Résultat</TableHead>
                    <TableHead className="w-24">
                      <SortableHeader
                        field="dateCloture"
                        currentField={sortField}
                        direction={sortDirection}
                        onSort={handleSort}
                      >
                        Date clôture
                      </SortableHeader>
                    </TableHead>
                    <TableHead className="w-20">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedMesures.map((mesure) => (
                    <TableRow 
                      key={mesure.refAEM}
                      className={getRowClassName(mesure)}
                    >
                      <TableCell className="font-medium text-xs">
                        <div>
                          <TextEditor
                            value={mesure.refAEM}
                            onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'refAEM', newValue)}
                            placeholder="Réf. AEM"
                            className="w-24 font-mono"
                            pattern="[0-9]{2}/[0-9]+"
                          />
                          {mesure.sourceGreffe && (
                            <div className="text-yellow-600 text-[10px] font-medium">GREFFE</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-xs font-mono">
                        {mesure.numeroParquet ? (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-800 border-blue-200">
                            <TextEditor
                              value={mesure.numeroParquet}
                              onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'numeroParquet', newValue)}
                              placeholder="N° Parquet"
                              className="w-28 font-mono border-0 bg-transparent p-0 h-auto"
                              pattern="[0-9]{2}/[0-9]+"
                            />
                          </Badge>
                        ) : (
                          <TextEditor
                            value={mesure.numeroParquet}
                            onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'numeroParquet', newValue)}
                            placeholder="N° Parquet"
                            className="w-28 font-mono"
                            pattern="[0-9]{2}/[0-9]+"
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-xs">
                        <TextEditor
                          value={mesure.nomPrenom}
                          onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'nomPrenom', newValue)}
                          placeholder="Nom Prénom"
                          className="w-36"
                          maxLength={100}
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <TextAreaEditor
                          value={mesure.faits}
                          onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'faits', newValue)}
                          placeholder="Description des faits"
                          maxLength={500}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {formatDateDDMMYYYY(mesure.dateReception)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <SelectEditor
                          value={mesure.secteurGeographique}
                          onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'secteurGeographique', newValue)}
                          options={secteurOptions}
                          placeholder="Secteur"
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <SelectEditor
                          value={mesure.referent}
                          onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'referent', newValue)}
                          options={referentOptions}
                          placeholder="Référent"
                        />
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        <Badge variant="secondary" className="text-xs">
                          {mesure.nombreEntretiensAIR || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <RencontresPREditor
                          value={mesure.nombreRencontresPR || 0}
                          onUpdate={(newValue) => handleUpdateRencontresPR(mesure.refAEM, newValue)}
                        />
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        <Badge variant="outline" className="text-xs">
                          {mesure.nombreCarences || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <SelectEditor
                          value={mesure.natureFinAIR}
                          onUpdate={(newValue) => handleUpdateField(mesure.refAEM, 'natureFinAIR', newValue)}
                          options={natureFinOptions}
                          placeholder="Nature fin"
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <ResultatEditor
                          value={mesure.resultatMesure}
                          onUpdate={(newValue, shouldClose) => handleUpdateResultat(mesure.refAEM, newValue, shouldClose)}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        <DateCloureEditor
                          value={mesure.dateCloture}
                          onUpdate={(newValue) => handleUpdateDateCloture(mesure.refAEM, newValue)}
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge className={getStatutColor(mesure)}>
                          {getStatutText(mesure)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal d'import AEM */}
      {showImportModal && (
        <AIRImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={onImportMesures}
        />
      )}

      {/* Modal d'import Greffe */}
      {showGreffeModal && (
        <GreffeImportModal
          isOpen={showGreffeModal}
          onClose={() => setShowGreffeModal(false)}
          mesuresAIR={mesures}
          onUpdateMesures={handleGreffeUpdates}
          onAddMesures={handleGreffeNewMesures}
        />
      )}

      {/* Première confirmation de suppression */}
      <ConfirmationDialog
        isOpen={showDeleteAllDialog}
        onClose={() => setShowDeleteAllDialog(false)}
        onConfirm={handleConfirmFirstDelete}
        title="⚠️ Supprimer toutes les mesures AIR ?"
        message={`Vous êtes sur le point de supprimer TOUTES les ${mesures.length} mesures AIR. Cette action est irréversible.`}
        confirmLabel="Continuer"
        cancelLabel="Annuler"
      />

      {/* Confirmation finale de suppression */}
      <ConfirmationDialog
        isOpen={showFinalDeleteDialog}
        onClose={() => setShowFinalDeleteDialog(false)}
        onConfirm={handleFinalDeleteAll}
        title="🚨 CONFIRMATION FINALE"
        message={`ÊTES-VOUS ABSOLUMENT CERTAIN de vouloir supprimer toutes les ${mesures.length} mesures AIR ?\n\nCette action est DÉFINITIVE et IRRÉVERSIBLE.`}
        confirmLabel="OUI, SUPPRIMER TOUT"
        cancelLabel="Non, annuler"
      />
    </div>
  );
};