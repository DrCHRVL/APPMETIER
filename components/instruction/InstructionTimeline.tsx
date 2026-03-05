import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import { 
  Clock, 
  Calendar, 
  Plus, 
  Edit3, 
  Trash2,
  CheckCircle,
  AlertCircle,
  User,
  FileText,
  Gavel,
  Microscope,
  Users,
  Search,
  UserPlus
} from 'lucide-react';
import { EnqueteInstruction } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface InstructionTimelineProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  isEditing: boolean;
}

interface TimelineEvent {
  id: number;
  date: string;
  type: 'ouverture' | 'dml' | 'op' | 'rd' | 'rapport' | 'ordonnance' | 'expertise' | 'cr' | 'audition' | 'interrogatoire' | 'placement_dp' | 'ipc' | 'autre';
  title: string;
  description?: string;
  automatic?: boolean;
  sourceId?: number; // ID de la source (DML, OP, etc.) pour la synchronisation
  sourceType?: 'dml' | 'op' | 'mex_placement' | 'mex_ipc'; // Type de source
}

// Liste prédéfinie d'événements
const PREDEFINED_EVENTS = [
  { category: 'Expertises', events: [
    'Expertise psychiatrique',
    'Expertise psychologique', 
    'Expertise ADN',
    'Expertise balistique',
    'Expertise biologique',
    'Expertise toxicologique',
    'Expertise comptable',
    'Expertise informatique',
    'Expertise phonique'
  ]},
  { category: 'Commissions rogatoires', events: [
    'CR envoyée',
    'CR revenue',
    'CR partie civile',
    'CR supplémentaire'
  ]},
  { category: 'Auditions', events: [
    'Audition victime',
    'Audition témoin', 
    'Interrogatoire au fond',
    'Confrontation',
    'Reconstitution'
  ]},
  { category: 'Procédure', events: [
    'Réquisitions supplétives (RS)',
    'Transport sur les lieux',
    'Perquisition',
    'Saisie',
    'Mise en examen'
  ]}
];

export const InstructionTimeline = ({
  instruction,
  onUpdate,
  isEditing
}: InstructionTimelineProps) => {
  const { showToast } = useToast();
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);

  // Formulaire événement
  const [eventForm, setEventForm] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'autre' as TimelineEvent['type'],
    title: '',
    description: '',
    predefinedCategory: '',
    predefinedEvent: ''
  });

  // Événements manuels stockés dans instruction.timeline
  const manualEvents: TimelineEvent[] = (instruction as any).timeline || [];

  // Génération de la timeline automatique
  const generateAutomaticEvents = (): TimelineEvent[] => {
    const events: TimelineEvent[] = [];

    // Ouverture information
    events.push({
      id: 1,
      date: instruction.dateDebut,
      type: 'ouverture',
      title: 'Ouverture de l\'information',
      description: `Instruction ${instruction.numeroInstruction}`,
      automatic: true
    });

    // DML avec détenu concerné
    instruction.dmls?.forEach((dml, index) => {
      const detenusConcernes = dml.concernedDetenus || [];
      const nomsDetenus = detenusConcernes.map(detenuId => {
        const mex = instruction.misEnExamen?.find(m => m.id === detenuId);
        return mex?.nom || 'Détenu inconnu';
      }).join(', ');

      events.push({
        id: 1000 + dml.id,
        date: dml.dateDepot,
        type: 'dml',
        title: `DML ${index + 1}`,
        description: `Pour: ${nomsDetenus || 'Détenu non spécifié'} - Échéance: ${new Date(dml.dateEcheance).toLocaleDateString()}`,
        automatic: true,
        sourceId: dml.id,
        sourceType: 'dml'
      });
    });

    // IPC (Interrogatoire première comparution) - un par mis en examen
    instruction.misEnExamen?.forEach(mex => {
      events.push({
        id: 6000 + mex.id,
        date: mex.dateExamen,
        type: 'ipc',
        title: `IPC - ${mex.nom}`,
        description: `Interrogatoire première comparution`,
        automatic: true,
        sourceId: mex.id,
        sourceType: 'mex_ipc'
      });
    });

    // Phases OP avec interpellations
    instruction.ops?.forEach((op, index) => {
      const nbInterpellations = op.interpellations?.length || 0;
      const nbPlacementsDP = op.interpellations?.filter(interp => {
        const mex = instruction.misEnExamen?.find(m => m.id === interp.misEnExamenId);
        return mex?.role === 'detenu';
      }).length || 0;

      let description = `${nbInterpellations} interpellation${nbInterpellations > 1 ? 's' : ''}`;
      if (nbPlacementsDP > 0) {
        description += ` (${nbPlacementsDP} placement${nbPlacementsDP > 1 ? 's' : ''} DP)`;
      }
      if (op.dureeJours && op.dureeJours > 1) {
        description += ` - ${op.dureeJours} jours`;
      }

      events.push({
        id: 5000 + op.id,
        date: op.date,
        type: 'op',
        title: op.description || `OP ${index + 1}`,
        description,
        automatic: true,
        sourceId: op.id,
        sourceType: 'op'
      });
    });

    // Placements DP depuis les mis en examen (uniquement les premiers placements)
    instruction.misEnExamen?.forEach(mex => {
      if (mex.role === 'detenu' && mex.datePlacementDP) {
        // Vérifier si ce placement n'est pas déjà couvert par une OP
        const isFromOP = instruction.ops?.some(op => 
          op.interpellations?.some(interp => 
            interp.misEnExamenId === mex.id && 
            interp.dateInterpellation === mex.datePlacementDP
          )
        );

        // N'ajouter que si ce n'est pas déjà dans une OP
        if (!isFromOP) {
          events.push({
            id: 7000 + mex.id,
            date: mex.datePlacementDP,
            type: 'placement_dp',
            title: `Placement DP - ${mex.nom}`,
            description: `Détention provisoire pour ${mex.dureeInitialeDP || '?'} mois`,
            automatic: true,
            sourceId: mex.id,
            sourceType: 'mex_placement'
          });
        }
      }
    });

    // RD
    if (instruction.rdData?.rendu && instruction.rdData.dateRendu) {
      events.push({
        id: 3001,
        date: instruction.rdData.dateRendu,
        type: 'rd',
        title: 'Réquisitoire définitif rendu',
        description: `${instruction.rdData.nbPages} pages`,
        automatic: true
      });
    }

    // Rapport d'appel
    if (instruction.rapportAppel?.rendu && instruction.rapportAppel.dateRendu) {
      events.push({
        id: 3002,
        date: instruction.rapportAppel.dateRendu,
        type: 'rapport',
        title: 'Rapport d\'appel rendu',
        description: `${instruction.rapportAppel.nbPages} pages`,
        automatic: true
      });
    }

    // Ordonnance finale
    if (instruction.etatReglement === 'ordonnance_rendue') {
      const lastEvent = events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      const estimatedDate = lastEvent ? lastEvent.date : instruction.dateDebut;
      
      events.push({
        id: 4001,
        date: estimatedDate,
        type: 'ordonnance',
        title: 'Ordonnance rendue',
        description: instruction.orientation ? `Orientation: ${instruction.orientation}` : undefined,
        automatic: true
      });
    }

    return events;
  };

  // Fusion et tri des événements
  const allEvents = [...generateAutomaticEvents(), ...manualEvents]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Ajout événement manuel
  const handleAddEvent = () => {
    if (!eventForm.title.trim()) {
      showToast('Titre requis', 'error');
      return;
    }

    const newEvent: TimelineEvent = {
      id: Date.now(),
      date: eventForm.date,
      type: eventForm.type,
      title: eventForm.title.trim(),
      description: eventForm.description.trim() || undefined,
      automatic: false
    };

    const updatedTimeline = [...manualEvents, newEvent];
    onUpdate(instruction.id, { timeline: updatedTimeline } as any);
    
    // Reset form
    setEventForm({
      date: new Date().toISOString().split('T')[0],
      type: 'autre',
      title: '',
      description: '',
      predefinedCategory: '',
      predefinedEvent: ''
    });
    setShowAddEvent(false);
    showToast('Événement ajouté', 'success');
  };

  // Suppression événement avec répercussion
  const handleDeleteEvent = (event: TimelineEvent) => {
    if (!confirm(`Supprimer l'événement "${event.title}" ?`)) {
      return;
    }

    let updates: Partial<EnqueteInstruction> = {};

    if (event.automatic && event.sourceType && event.sourceId) {
      // Suppression avec répercussion sur les données source
      switch (event.sourceType) {
        case 'dml':
          // Supprimer la DML correspondante
          const updatedDMLs = instruction.dmls?.filter(dml => dml.id !== event.sourceId) || [];
          updates.dmls = updatedDMLs;
          showToast('DML supprimée de la timeline et des compteurs', 'success');
          break;

        case 'op':
          // Supprimer l'OP correspondante
          const updatedOPs = instruction.ops?.filter(op => op.id !== event.sourceId) || [];
          updates.ops = updatedOPs;
          showToast('Phase OP supprimée de la timeline et des compteurs', 'success');
          break;

        case 'mex_placement':
          // Supprimer la date de placement DP du mis en examen
          const updatedMisEnExamen = instruction.misEnExamen?.map(mex => 
            mex.id === event.sourceId ? {
              ...mex,
              datePlacementDP: undefined,
              dateFinDP: undefined,
              dureeInitialeDP: undefined,
              role: 'libre' as const
            } : mex
          ) || [];
          updates.misEnExamen = updatedMisEnExamen;
          showToast('Date de placement DP supprimée du mis en examen', 'success');
          break;

        case 'mex_ipc':
          // Supprimer le mis en examen correspondant (attention, cela supprime tout le mis en examen)
          const updatedMisEnExamenIPC = instruction.misEnExamen?.filter(mex => mex.id !== event.sourceId) || [];
          updates.misEnExamen = updatedMisEnExamenIPC;
          showToast('Mis en examen supprimé (et son IPC)', 'success');
          break;
      }
    } else {
      // Suppression d'un événement manuel
      const updatedTimeline = manualEvents.filter(e => e.id !== event.id);
      updates.timeline = updatedTimeline;
      showToast('Événement supprimé', 'success');
    }

    onUpdate(instruction.id, updates);
  };

  // Sélection événement prédéfini
  const handlePredefinedSelect = () => {
    if (eventForm.predefinedEvent) {
      setEventForm({
        ...eventForm,
        title: eventForm.predefinedEvent,
        type: eventForm.predefinedCategory === 'Expertises' ? 'expertise' :
              eventForm.predefinedCategory === 'Commissions rogatoires' ? 'cr' :
              eventForm.predefinedCategory === 'Auditions' ? 'audition' : 'autre'
      });
    }
  };

  // Icône selon le type
  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'ouverture':
        return <Calendar className="h-4 w-4 text-blue-500" />;
      case 'dml':
        return <FileText className="h-4 w-4 text-purple-500" />;
      case 'op':
        return <UserPlus className="h-4 w-4 text-indigo-500" />;
      case 'ipc':
        return <User className="h-4 w-4 text-yellow-500" />;
      case 'placement_dp':
        return <Gavel className="h-4 w-4 text-red-500" />;
      case 'rd':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'rapport':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case 'ordonnance':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'expertise':
        return <Microscope className="h-4 w-4 text-indigo-500" />;
      case 'cr':
        return <FileText className="h-4 w-4 text-teal-500" />;
      case 'audition':
        return <User className="h-4 w-4 text-cyan-500" />;
      case 'interrogatoire':
        return <Users className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  // Couleur selon le type
  const getEventColor = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'ouverture':
        return 'border-blue-200 bg-blue-50';
      case 'dml':
        return 'border-purple-200 bg-purple-50';
      case 'op':
        return 'border-indigo-200 bg-indigo-50';
      case 'ipc':
        return 'border-yellow-200 bg-yellow-50';
      case 'placement_dp':
        return 'border-red-200 bg-red-50';
      case 'rd':
        return 'border-green-200 bg-green-50';
      case 'rapport':
        return 'border-blue-200 bg-blue-50';
      case 'ordonnance':
        return 'border-green-300 bg-green-100';
      case 'expertise':
        return 'border-indigo-200 bg-indigo-50';
      case 'cr':
        return 'border-teal-200 bg-teal-50';
      case 'audition':
        return 'border-cyan-200 bg-cyan-50';
      case 'interrogatoire':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Timeline procédurale ({allEvents.length})
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddEvent(!showAddEvent)}
              className="h-7 px-2 text-green-600"
            >
              <Plus className="h-3 w-3 mr-1" />
              Événement
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Formulaire ajout événement */}
        {showAddEvent && (
          <div className="border rounded-lg p-3 bg-blue-50">
            <h4 className="text-sm font-medium mb-3">Nouvel événement</h4>
            
            {/* Sélection prédéfinie */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <Label className="text-xs">Catégorie prédéfinie</Label>
                <Select
                  value={eventForm.predefinedCategory}
                  onChange={(e) => {
                    setEventForm({...eventForm, predefinedCategory: e.target.value, predefinedEvent: ''});
                  }}
                  className="h-8 text-xs"
                >
                  <option value="">Sélectionner...</option>
                  {PREDEFINED_EVENTS.map(cat => (
                    <option key={cat.category} value={cat.category}>{cat.category}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="text-xs">Événement prédéfini</Label>
                <div className="flex gap-1">
                  <Select
                    value={eventForm.predefinedEvent}
                    onChange={(e) => setEventForm({...eventForm, predefinedEvent: e.target.value})}
                    className="h-8 text-xs flex-1"
                    disabled={!eventForm.predefinedCategory}
                  >
                    <option value="">Sélectionner...</option>
                    {eventForm.predefinedCategory && 
                      PREDEFINED_EVENTS
                        .find(cat => cat.category === eventForm.predefinedCategory)
                        ?.events.map(event => (
                          <option key={event} value={event}>{event}</option>
                        ))
                    }
                  </Select>
                  <Button
                    size="sm"
                    onClick={handlePredefinedSelect}
                    disabled={!eventForm.predefinedEvent}
                    className="h-8 px-2 text-xs"
                  >
                    ✓
                  </Button>
                </div>
              </div>
            </div>

            {/* Formulaire manuel */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={eventForm.date}
                  onChange={(e) => setEventForm({...eventForm, date: e.target.value})}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={eventForm.type}
                  onChange={(e) => setEventForm({...eventForm, type: e.target.value as TimelineEvent['type']})}
                  className="h-8 text-xs"
                >
                  <option value="autre">Autre</option>
                  <option value="expertise">Expertise</option>
                  <option value="cr">Commission rogatoire</option>
                  <option value="audition">Audition</option>
                  <option value="interrogatoire">Interrogatoire</option>
                </Select>
              </div>
            </div>
            
            <div className="mb-2">
              <Label className="text-xs">Titre</Label>
              <Input
                value={eventForm.title}
                onChange={(e) => setEventForm({...eventForm, title: e.target.value})}
                placeholder="Titre de l'événement"
                className="h-8 text-xs"
              />
            </div>
            
            <div className="mb-2">
              <Label className="text-xs">Description (optionnel)</Label>
              <Input
                value={eventForm.description}
                onChange={(e) => setEventForm({...eventForm, description: e.target.value})}
                placeholder="Description de l'événement..."
                className="h-8 text-xs"
              />
            </div>
            
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddEvent} className="text-xs">
                Ajouter
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setShowAddEvent(false)} 
                className="text-xs"
              >
                Annuler
              </Button>
            </div>
          </div>
        )}

        {/* Timeline ULTRA-DENSE */}
        <div className="space-y-1 overflow-auto">
          {allEvents.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Clock className="h-6 w-6 mx-auto mb-2 text-gray-300" />
              <p className="text-xs">Aucun événement</p>
            </div>
          ) : (
            <div className="space-y-1">
              {allEvents.map((event, index) => (
                <div 
                  key={event.id} 
                  className={`flex items-center gap-2 p-2 rounded border ${getEventColor(event.type)} hover:shadow-sm transition-shadow`}
                >
                  {/* Icône compacte */}
                  <div className="flex-shrink-0">
                    {getEventIcon(event.type)}
                  </div>

                  {/* Contenu sur une ligne */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium truncate">{event.title}</span>
                        {event.automatic && (
                          <Badge variant="outline" className="text-xs h-4 px-1">
                            A
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-gray-500">
                          {new Date(event.date).toLocaleDateString()}
                        </span>
                        {isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEvent(event)}
                            className="h-4 w-4 p-0 text-red-600"
                            title={event.automatic ? 'Supprimer (répercussion)' : 'Supprimer'}
                          >
                            <Trash2 className="h-2 w-2" />
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {/* Description en survol ou ligne séparée très compacte */}
                    {event.description && (
                      <div className="text-xs text-gray-500 truncate mt-1">
                        {event.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Résumé chronologique */}
        {allEvents.length > 0 && (
          <div className="pt-3 border-t bg-gray-50 rounded p-3">
            <h4 className="text-sm font-medium mb-2">Résumé chronologique</h4>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-gray-600">Premier événement:</div>
                <div className="font-medium">
                  {new Date(allEvents[0].date).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="text-gray-600">Dernier événement:</div>
                <div className="font-medium">
                  {new Date(allEvents[allEvents.length - 1].date).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="text-gray-600">Durée totale:</div>
                <div className="font-medium">
                  {Math.ceil(
                    (new Date(allEvents[allEvents.length - 1].date).getTime() - 
                     new Date(allEvents[0].date).getTime()) / (1000 * 60 * 60 * 24)
                  )} jours
                </div>
              </div>
              <div>
                <div className="text-gray-600">Événements:</div>
                <div className="font-medium">{allEvents.length} total</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};