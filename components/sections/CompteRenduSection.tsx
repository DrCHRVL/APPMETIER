import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { Label } from '../ui/label';
import { Enquete, CompteRendu, EnqueteInstruction } from '@/types/interfaces';
import { X, FileText, Calendar, User } from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useUser } from '@/contexts/UserContext';

interface CompteRenduSectionProps {
  enquete: Enquete | EnqueteInstruction;
  editingCR: CompteRendu | null;
  onAddCR: (cr: Omit<CompteRendu, 'id'>) => void;
  onUpdateCR: (id: number, updates: Partial<CompteRendu>) => void;
  onDeleteCR: (id: number) => void;
  setEditingCR: (cr: CompteRendu | null) => void;
  isEditing: boolean;
}

// Types étendus pour les instructions
interface CompteRenduInstruction extends CompteRendu {
  type?: 'note' | 'synthese';
  acteType?: string;
  dateActe?: string;
}

// Configuration des types d'actes
const ACTE_TYPES = {
  audition: {
    label: 'Audition',
    icon: '👥',
    subtypes: {
      audition_temoin: 'Audition témoin',
      audition_victime: 'Audition victime'
    }
  },
  interrogatoire: {
    label: 'Interrogatoire',
    icon: '⚖️',
    subtypes: {
      ipc: 'IPC (Première comparution)',
      interrogatoire_fond: 'IF (Interrogatoire au fond)',
      confrontation: 'Confrontation'
    }
  },
  expertise: {
    label: 'Expertise',
    icon: '🔬',
    subtypes: {
      expertise_psychologique: 'Expertise psychologique',
      expertise_psychiatrique: 'Expertise psychiatrique',
      expertise_adn: 'Expertise ADN',
      expertise_autre: 'Autre expertise'
    }
  },
  commission_rogatoire: {
    label: 'Commission rogatoire',
    icon: '📋',
    subtypes: {
      cr_retour: 'Retour de commission rogatoire'
    }
  },
  autre: {
    label: 'Autre acte',
    icon: '📄',
    subtypes: {
      autre_acte: 'Autre acte procédural'
    }
  }
};

// Convertit le texte markdown simple en HTML pour l'affichage
// Détecte automatiquement HTML (nouveau format WYSIWYG) vs markdown (ancien format)
const renderFormattedText = (text: string): string => {
  if (/<[a-z][\s\S]*?>/i.test(text)) return text; // déjà du HTML
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/==(.*?)==/g, '<mark style="background:#fef08a;padding:1px 2px">$1</mark>')
    .replace(/^- (.*)$/gm, '• $1')
    .replace(/\n/g, '<br>');
};

export const CompteRenduSection = ({
  enquete,
  editingCR,
  onAddCR,
  onUpdateCR,
  onDeleteCR,
  setEditingCR,
  isEditing
}: CompteRenduSectionProps) => {
  // Détection si on est dans une instruction
  const isInstruction = 'numeroInstruction' in enquete && 'cabinet' in enquete;

  // États pour l'UX
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 });

  // Utilisateur courant (pour distinguer les CR de l'autre utilisateur)
  const { user } = useUser();
  const currentUser = user?.windowsUsername || '';

  // Charge le contenu de l'éditeur à l'ouverture (brouillon ou markdown converti)
  useEffect(() => {
    if (!editingCR) return;
    setIsDirty(false);
    setError(null);
    const key = `cr-draft-${editingCR.id || 'new'}`;
    const draft = localStorage.getItem(key);
    let initialHtml = '';
    if (draft) {
      try { initialHtml = JSON.parse(draft).description || ''; } catch {}
    }
    if (!initialHtml) {
      initialHtml = editingCR.description ? renderFormattedText(editingCR.description) : '';
    }
    // Injecter après le rendu du DOM
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    }, 0);
  }, [editingCR?.id]);

  // Sauvegarde brouillon dans localStorage (debounce 800ms)
  const scheduleDraftSave = () => {
    if (!editingCR) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const key = `cr-draft-${editingCR.id || 'new'}`;
      localStorage.setItem(key, JSON.stringify({
        description: editorRef.current?.innerHTML || ''
      }));
    }, 800);
  };

  // Drag : écouteurs globaux montés une seule fois
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current.dragging || !dialogRef.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      dialogRef.current.style.left = `${dragState.current.initLeft + dx}px`;
      dialogRef.current.style.top  = `${dragState.current.initTop  + dy}px`;
    };
    const onMouseUp = () => { dragState.current.dragging = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    if (!dialogRef.current) return;
    const rect = dialogRef.current.getBoundingClientRect();
    dragState.current = { dragging: true, startX: e.clientX, startY: e.clientY, initLeft: rect.left, initTop: rect.top };
    e.preventDefault();
  };

  // Fermeture avec confirmation si contenu modifié
  const clearAndClose = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setError(null);
    setIsDirty(false);
    setShowConfirmClose(false);
    setEditingCR(null);
  };

  const handleClose = () => {
    if (isDirty) { setShowConfirmClose(true); } else { clearAndClose(); }
  };

  // États spécifiques aux instructions
  const [showTypeChoice, setShowTypeChoice] = useState(false);
  const [selectedCRType, setSelectedCRType] = useState<'note' | 'synthese'>('note');
  const [showActeSelector, setShowActeSelector] = useState(false);
  const [selectedActeCategory, setSelectedActeCategory] = useState<string>('');
  const [selectedActeType, setSelectedActeType] = useState<string>('');
  const [customActeType, setCustomActeType] = useState<string>('');
  const [acteDate, setActeDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Mémoisation des CR triés pour les performances
  const sortedCRs = useMemo(() => 
    [...enquete.comptesRendus].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ), 
    [enquete.comptesRendus]
  );

  const handleNewCR = () => {
    setError(null);

    if (isInstruction) {
      // Pour les instructions, d'abord demander le type
      setShowTypeChoice(true);
    } else {
      // Pour les enquêtes, comportement classique
      setEditingCR({
        id: 0,
        date: new Date().toISOString().split('T')[0],
        enqueteur: '',
        description: '',
        createdBy: currentUser
      });
    }
  };

  const handleTypeChoice = (type: 'note' | 'synthese') => {
    setSelectedCRType(type);
    setShowTypeChoice(false);

    if (type === 'synthese') {
      // Pour une synthèse, ouvrir le sélecteur d'acte
      setShowActeSelector(true);
    } else {
      // Pour une note, comportement classique
      setEditingCR({
        id: 0,
        date: new Date().toISOString().split('T')[0],
        enqueteur: '',
        description: '',
        type: 'note',
        createdBy: currentUser
      } as CompteRenduInstruction);
    }
  };

  const handleActeSelection = () => {
    if (!selectedActeType && !customActeType) {
      setError('Veuillez sélectionner un type d\'acte');
      return;
    }

    const finalActeType = selectedActeType === 'expertise_autre' || selectedActeType === 'autre_acte' 
      ? customActeType 
      : selectedActeType;

    setEditingCR({
      id: 0,
      date: new Date().toISOString().split('T')[0],
      enqueteur: '',
      description: '',
      type: 'synthese',
      acteType: finalActeType,
      dateActe: acteDate,
      createdBy: currentUser
    } as CompteRenduInstruction);

    setShowActeSelector(false);
    resetActeSelector();
  };

  const resetActeSelector = () => {
    setSelectedActeCategory('');
    setSelectedActeType('');
    setCustomActeType('');
    setActeDate(new Date().toISOString().split('T')[0]);
  };

  // Validation simple
  const validateCR = (cr: CompteRendu): string | null => {
    if (!cr.enqueteur.trim()) return 'L\'enquêteur est requis';
    // Dépouiller le HTML pour vérifier si la description est vide
    const tmp = document.createElement('div');
    tmp.innerHTML = cr.description;
    if (!(tmp.textContent || tmp.innerText || '').trim()) return 'La description est requise';
    if (!cr.date) return 'La date est requise';
    
    // Validation spécifique aux synthèses d'instructions
    if (isInstruction) {
      const crInstruction = cr as CompteRenduInstruction;
      if (crInstruction.type === 'synthese') {
        if (!crInstruction.acteType) return 'Le type d\'acte est requis pour une synthèse';
        if (!crInstruction.dateActe) return 'La date de l\'acte est requise pour une synthèse';
      }
    }
    
    return null;
  };

  const handleSave = async () => {
    if (!editingCR) return;

    // Lire le contenu HTML de l'éditeur WYSIWYG
    const htmlContent = editorRef.current?.innerHTML || '';
    const crToSave = { ...editingCR, description: htmlContent };

    // Validation
    const validationError = validateCR(crToSave);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      if (crToSave.id) {
        await onUpdateCR(crToSave.id, crToSave);
      } else {
        await onAddCR({
          date: crToSave.date,
          enqueteur: crToSave.enqueteur,
          description: htmlContent,
          createdBy: crToSave.createdBy,
          ...(isInstruction && {
            type: (crToSave as CompteRenduInstruction).type,
            acteType: (crToSave as CompteRenduInstruction).acteType,
            dateActe: (crToSave as CompteRenduInstruction).dateActe
          })
        });

        // Pour les synthèses d'instructions, générer l'événement timeline
        if (isInstruction && (crToSave as CompteRenduInstruction).type === 'synthese') {
          await generateTimelineEvent(crToSave as CompteRenduInstruction);
        }
      }
      // Effacer le brouillon après sauvegarde réussie
      const key = `cr-draft-${editingCR.id || 'new'}`;
      localStorage.removeItem(key);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      setIsDirty(false);
      setEditingCR(null);
    } catch (error) {
      setError('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  // Génération automatique d'événement timeline pour les synthèses
  const generateTimelineEvent = async (cr: CompteRenduInstruction) => {
    if (!isInstruction || !cr.acteType || !cr.dateActe) return;

    const instruction = enquete as EnqueteInstruction;
    
    // Mapper le type d'acte vers le type timeline
    const getTimelineType = (acteType: string): string => {
      if (acteType.includes('audition')) return 'audition';
      if (acteType.includes('interrogatoire') || acteType.includes('ipc') || acteType.includes('confrontation')) return 'interrogatoire';
      if (acteType.includes('expertise')) return 'expertise';
      if (acteType.includes('commission') || acteType.includes('cr_')) return 'cr';
      return 'autre';
    };

    const timelineEvent = {
      id: Date.now() + Math.random(), // ID unique
      date: cr.dateActe,
      type: getTimelineType(cr.acteType),
      title: ACTE_TYPES[selectedActeCategory]?.subtypes[cr.acteType] || cr.acteType,
      description: `Synthèse rédigée le ${new Date(cr.date).toLocaleDateString()}`,
      automatic: false
    };

    // Ajouter à la timeline existante
    const currentTimeline = (instruction as any).timeline || [];
    const updatedTimeline = [...currentTimeline, timelineEvent];

    // Mettre à jour l'instruction (vous devrez adapter selon votre architecture)
    if (typeof (enquete as any).onUpdate === 'function') {
      (enquete as any).onUpdate(instruction.id, { timeline: updatedTimeline });
    }
  };

  // Raccourci Ctrl+S → enregistrer ; Ctrl+H → surligner
  useEffect(() => {
    if (!editingCR) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') { e.preventDefault(); handleSave(); }
      if (e.key === 'h') { e.preventDefault(); editorRef.current?.focus(); document.execCommand('hiliteColor', false, '#fef08a'); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingCR, isSaving]);

  const formatDescription = useMemo(() => (text: string) => {
    const words = text.split(' ');
    const formattedWords = words.map(word => {
      if (word.length > 50) {
        return word.match(/.{1,50}/g)?.join('-') || word;
      }
      return word;
    });
    return formattedWords.join(' ');
  }, []);

  // Fonction pour obtenir le label d'un type d'acte
  const getActeTypeLabel = (acteType: string): string => {
    for (const category of Object.values(ACTE_TYPES)) {
      if (category.subtypes[acteType]) {
        return category.subtypes[acteType];
      }
    }
    return acteType;
  };

  // Rendu du CR avec indicateurs visuels pour les instructions
  const renderCR = (cr: CompteRendu) => {
    const crInstruction = cr as CompteRenduInstruction;
    const isSynthese = isInstruction && crInstruction.type === 'synthese';

    // CR créé par un autre utilisateur → fond bleuté
    const isFromColleague =
      currentUser &&
      cr.createdBy &&
      cr.createdBy !== currentUser;

    let bgClass = 'bg-gray-50';
    let hoverClass = 'hover:bg-gray-100';
    if (isSynthese) {
      bgClass = 'bg-blue-50';
      hoverClass = 'hover:bg-blue-100';
    } else if (isFromColleague) {
      bgClass = 'bg-sky-50';
      hoverClass = 'hover:bg-sky-100';
    }

    return (
      <div
        key={cr.id}
        className={`${bgClass} ${hoverClass} ${isSynthese ? 'border-l-4 border-l-blue-400' : isFromColleague ? 'border-l-4 border-l-sky-300' : ''} p-4 rounded relative group transition-colors`}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-sm">
                {new Date(cr.date).toLocaleDateString()} - {cr.enqueteur}
              </p>

              {/* Indicateur collègue */}
              {isFromColleague && (
                <Badge variant="outline" className="text-xs h-5 px-2 bg-sky-100 text-sky-700 border-sky-300">
                  <User className="h-3 w-3 mr-1" />
                  {cr.createdBy}
                </Badge>
              )}

              {/* Badges pour les synthèses d'instructions */}
              {isSynthese && crInstruction.acteType && (
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs h-5 px-2 bg-blue-100 text-blue-700 border-blue-300">
                    <FileText className="h-3 w-3 mr-1" />
                    Synthèse
                  </Badge>
                  <Badge variant="outline" className="text-xs h-5 px-2 bg-white">
                    {getActeTypeLabel(crInstruction.acteType)}
                  </Badge>
                  {crInstruction.dateActe && (
                    <Badge variant="outline" className="text-xs h-5 px-2 bg-white">
                      <Calendar className="h-3 w-3 mr-1" />
                      {new Date(crInstruction.dateActe).toLocaleDateString()}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div
              className="text-gray-600 mt-1 text-sm break-words"
              style={{ wordBreak: 'break-word', hyphens: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderFormattedText(formatDescription(cr.description)) }}
            />
          </div>

          {isEditing && (
            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setEditingCR(cr);
                }}
              >
                Modifier
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => onDeleteCR(cr.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Comptes rendus</h3>
        <Button 
          onClick={handleNewCR}
          size="sm"
          variant="ghost"
        >
          Nouveau CR
        </Button>
      </div>

      <div className="space-y-4">
        {sortedCRs.map(renderCR)}
      </div>

      {/* Modal de choix du type (Instructions uniquement) */}
      {showTypeChoice && isInstruction && (
        <Dialog open={showTypeChoice} onOpenChange={setShowTypeChoice}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Type de compte-rendu</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Quel type de compte-rendu voulez-vous créer ?
              </p>
              
              <div className="grid grid-cols-1 gap-3">
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start hover:bg-gray-50"
                  onClick={() => handleTypeChoice('note')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4" />
                    <span className="font-medium">Note ponctuelle</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Note libre ou observation sur l'instruction
                  </span>
                </Button>
                
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start hover:bg-blue-50 border-blue-200"
                  onClick={() => handleTypeChoice('synthese')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-700">Synthèse d'acte</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Synthèse d'un acte procédural (génère un événement timeline)
                  </span>
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de sélection d'acte (Synthèses uniquement) */}
      {showActeSelector && (
        <Dialog open={showActeSelector} onOpenChange={setShowActeSelector}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Sélection du type d'acte</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {error && (
                <div className="text-red-500 text-sm p-2 bg-red-50 rounded">
                  {error}
                </div>
              )}

              <div>
                <Label className="text-sm font-medium">Date de l'acte</Label>
                <Input
                  type="date"
                  value={acteDate}
                  onChange={(e) => setActeDate(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">Catégorie d'acte</Label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(ACTE_TYPES).map(([key, category]) => (
                    <Button
                      key={key}
                      variant={selectedActeCategory === key ? "default" : "outline"}
                      className="h-auto p-3 flex flex-col items-center"
                      onClick={() => {
                        setSelectedActeCategory(key);
                        setSelectedActeType('');
                        setCustomActeType('');
                      }}
                    >
                      <span className="text-lg mb-1">{category.icon}</span>
                      <span className="text-sm">{category.label}</span>
                    </Button>
                  ))}
                </div>
              </div>

              {selectedActeCategory && (
                <div>
                  <Label className="text-sm font-medium mb-2 block">Type d'acte spécifique</Label>
                  <div className="space-y-2">
                    {Object.entries(ACTE_TYPES[selectedActeCategory].subtypes).map(([key, label]) => (
                      <Button
                        key={key}
                        variant={selectedActeType === key ? "default" : "outline"}
                        className="w-full justify-start"
                        onClick={() => {
                          setSelectedActeType(key);
                          setCustomActeType('');
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>

                  {/* Champ personnalisé pour "Autre" */}
                  {(selectedActeType === 'expertise_autre' || selectedActeType === 'autre_acte') && (
                    <div className="mt-3">
                      <Label className="text-sm font-medium">
                        Précisez le type {selectedActeType === 'expertise_autre' ? 'd\'expertise' : 'd\'acte'}
                      </Label>
                      <Input
                        value={customActeType}
                        onChange={(e) => setCustomActeType(e.target.value)}
                        placeholder={selectedActeType === 'expertise_autre' 
                          ? "Ex: Expertise balistique, comptable..." 
                          : "Ex: Transport sur les lieux, saisie..."
                        }
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowActeSelector(false);
                resetActeSelector();
              }}>
                Annuler
              </Button>
              <Button 
                onClick={handleActeSelection}
                disabled={!selectedActeType && !customActeType}
              >
                Continuer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal d'édition du CR */}
      {editingCR && (
        <Dialog
          open={!!editingCR}
          onOpenChange={(open) => { if (!open) handleClose(); }}
          modal={false}
        >
          <DialogContent
            ref={dialogRef}
            className="w-[500px] overflow-auto max-h-[80vh] fixed transform-none shadow-xl border border-gray-300"
            style={{ top: '40%', left: '55%' }}
            onInteractOutside={(e) => e.preventDefault()}
          >
            {/* Boîte de confirmation fermeture */}
            {showConfirmClose && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
                  <p className="text-sm font-medium text-gray-800">Abandonner la rédaction ?</p>
                  <p className="text-xs text-gray-500">Le brouillon reste sauvegardé localement.</p>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => setShowConfirmClose(false)}>Reprendre</Button>
                    <Button variant="destructive" size="sm" onClick={clearAndClose}>Abandonner</Button>
                  </div>
                </div>
              </div>
            )}

            <DialogHeader
              className="cursor-grab active:cursor-grabbing select-none"
              onMouseDown={handleDragStart}
            >
              <DialogTitle>
                {editingCR.id ? 'Modifier le compte-rendu' :
                 isInstruction && (editingCR as CompteRenduInstruction).type === 'synthese'
                   ? 'Nouvelle synthèse d\'acte'
                   : 'Nouveau compte-rendu'
                }
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {error && (
                <div className="text-red-500 text-sm p-2 bg-red-50 rounded">
                  {error}
                </div>
              )}

              {/* Affichage des infos de la synthèse */}
              {isInstruction && (editingCR as CompteRenduInstruction).type === 'synthese' && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-700">Synthèse d'acte</span>
                  </div>
                  <div className="text-sm space-y-1">
                    <div>Type: {getActeTypeLabel((editingCR as CompteRenduInstruction).acteType || '')}</div>
                    <div>Date de l'acte: {(editingCR as CompteRenduInstruction).dateActe && 
                      new Date((editingCR as CompteRenduInstruction).dateActe!).toLocaleDateString()}</div>
                  </div>
                </div>
              )}

              <Input
                type="text"
                placeholder="Enquêteur"
                value={editingCR.enqueteur}
                onChange={(e) => {
                  setError(null);
                  setEditingCR({
                    ...editingCR,
                    enqueteur: e.target.value
                  });
                }}
              />
              
              <Input
                type="date"
                value={editingCR.date.split('T')[0]}
                onChange={(e) => {
                  setError(null);
                  setEditingCR({
                    ...editingCR,
                    date: e.target.value
                  });
                }}
              />
              
              {/* Barre de mise en forme WYSIWYG */}
              <div>
                <div className="flex gap-1 p-1 border border-b-0 rounded-t bg-gray-50 text-xs text-gray-400 items-center">
                  <button
                    type="button"
                    title="Gras — Ctrl+B"
                    className="px-2 py-1 text-sm font-bold hover:bg-gray-200 rounded text-gray-700"
                    onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('bold'); }}
                  >G</button>
                  <button
                    type="button"
                    title="Souligné — Ctrl+U"
                    className="px-2 py-1 text-sm underline hover:bg-gray-200 rounded text-gray-700"
                    onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('underline'); }}
                  >S</button>
                  <button
                    type="button"
                    title="Surligner — Ctrl+H"
                    className="px-2 py-1 text-sm hover:bg-gray-200 rounded"
                    style={{ background: '#fef08a' }}
                    onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('hiliteColor', false, '#fef08a'); }}
                  >HL</button>
                  <button
                    type="button"
                    title="Liste à puces"
                    className="px-2 py-1 text-sm hover:bg-gray-200 rounded font-mono text-gray-700"
                    onMouseDown={(e) => { e.preventDefault(); editorRef.current?.focus(); document.execCommand('insertUnorderedList'); }}
                  >–</button>
                  <span className="ml-auto pr-1">Ctrl+S pour enregistrer</span>
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="w-full min-h-[200px] p-2 border rounded-b rounded-t-none focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{ wordBreak: 'break-word', hyphens: 'auto' }}
                  data-placeholder={isInstruction && (editingCR as CompteRenduInstruction).type === 'synthese'
                    ? "Synthèse de l'acte procédural..."
                    : "Description"}
                  onInput={() => { setIsDirty(true); scheduleDraftSave(); }}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button 
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};