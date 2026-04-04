import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MecAutocompleteInput } from '@/components/ui/MecAutocompleteInput';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { X, Clock } from 'lucide-react';
import { useState, useCallback } from 'react';
import { NewEnqueteData, Tag } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { useTags } from '@/hooks/useTags';

interface NewEnqueteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (enquete: NewEnqueteData) => void;
  cheminBase: string;
  /** Noms de tous les MEC connus (cross-dossiers) pour suggestions */
  allKnownMec?: string[];
}

export const NewEnqueteModal = ({
  isOpen,
  onClose,
  onSubmit,
  cheminBase,
  allKnownMec = []
}: NewEnqueteModalProps) => {
  const { getTagsByCategory, isLoading } = useTags();
  const [newEnqueteData, setNewEnqueteData] = useState<NewEnqueteData>({
    numero: '',
    dateDebut: new Date().toISOString().split('T')[0],
    services: ['', ''],
    description: '',
    misEnCause: [],
    geolocalisations: [],
    ecoutes: [],
    comptesRendus: [],
    actes: [],
    notes: '',
    tags: [],
    cheminBase,
    documents: []
  });

  const [newMecName, setNewMecName] = useState('');
  const [newMecRole, setNewMecRole] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [isEnqueteAVenir, setIsEnqueteAVenir] = useState(false);
  const { showToast } = useToast();

  const resetForm = useCallback(() => {
    setNewEnqueteData({
      numero: '',
      dateDebut: new Date().toISOString().split('T')[0],
      services: ['', ''],
      description: '',
      misEnCause: [],
      geolocalisations: [],
      ecoutes: [],
      comptesRendus: [],
      actes: [],
      notes: '',
      tags: [],
      cheminBase,
      documents: []
    });
    setNewMecName('');
    setNewMecRole('');
    setSelectedTags([]);
    setIsEnqueteAVenir(false);
  }, [cheminBase]);

  const handleAddService = useCallback((index: number, value: string) => {
    if (value) {
      const services = getTagsByCategory('services');
      const selectedService = services.find(tag => tag.value === value);
      
      if (selectedService) {
        // Créer le tag de service
        const serviceTag: Tag = {
          id: selectedService.id,
          value: selectedService.value,
          category: 'services'
        };

        // Séparer les tags services et non-services
        const nonServiceTags = selectedTags.filter(tag => tag.category !== 'services');
        const existingServiceTags = selectedTags.filter(tag => tag.category === 'services');

        // Remplacer ou ajouter le service à la position donnée
        const newServiceTags = [...existingServiceTags];
        if (index < newServiceTags.length) {
          newServiceTags[index] = serviceTag;
        } else {
          newServiceTags.push(serviceTag);
        }

        const allTags = [...newServiceTags, ...nonServiceTags];

        setSelectedTags(allTags);

        // Mettre à jour aussi services[] pour compatibilité (sera supprimé plus tard)
        const newServices = [...newEnqueteData.services];
        newServices[index] = value;
        setNewEnqueteData(prev => ({ ...prev, services: newServices }));
      }
    }
  }, [selectedTags, getTagsByCategory, newEnqueteData.services]);

  const handleAddInfraction = useCallback((value: string) => {
    if (value) {
      const infractions = getTagsByCategory('infractions');
      const selectedInfraction = infractions.find(tag => tag.value === value);
      
      if (selectedInfraction && !selectedTags.some(tag => tag.id === selectedInfraction.id)) {
        setSelectedTags(prev => [...prev, {
          id: selectedInfraction.id,
          value: selectedInfraction.value,
          category: 'infractions'
        }]);
      }
    }
  }, [selectedTags, getTagsByCategory]);

  const handleRemoveTag = useCallback((tagId: string) => {
    setSelectedTags(prev => prev.filter(tag => tag.id !== tagId));
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newEnqueteData.numero) {
      showToast('Le numéro d\'enquête est obligatoire', 'error');
      return;
    }

    // Créer tous les tags (services + infractions + enquête à venir)
    const dureeTags = getTagsByCategory('duree');
    const aVenirTag = dureeTags.find(t => t.value === 'enquête à venir');
    const allTags = [
      ...selectedTags,
      ...(isEnqueteAVenir ? [{
        id: aVenirTag?.id || `duree-${Date.now()}`,
        value: 'enquête à venir',
        category: 'duree' as const
      }] : [])
    ];

    try {
      const cleanedData = {
        ...newEnqueteData,
        dateDebut: isEnqueteAVenir ? '' : newEnqueteData.dateDebut,
        // Garder services[] synchronisé pour l'instant (sera supprimé dans une future version)
        services: selectedTags
          .filter(tag => tag.category === 'services')
          .map(tag => tag.value)
          .filter(Boolean),
        tags: allTags
      };

      onSubmit(cleanedData);
      showToast('Enquête créée avec succès', 'success');
      resetForm();
      onClose();
    } catch (error) {
      showToast('Erreur lors de la création de l\'enquête', 'error');
    }
  }, [newEnqueteData, selectedTags, isEnqueteAVenir, onSubmit, onClose, showToast, resetForm]);

  const handleAddMec = useCallback(() => {
    if (newMecName.trim()) {
      setNewEnqueteData(prev => ({
        ...prev,
        misEnCause: [...prev.misEnCause, {
          id: Date.now(),
          nom: newMecName.trim(),
          role: newMecRole.trim() || undefined,
          statut: 'actif'
        }]
      }));
      setNewMecName('');
      setNewMecRole('');
    }
  }, [newMecName, newMecRole]);

  const handleRemoveMec = useCallback((index: number) => {
    setNewEnqueteData(prev => {
      const newMecs = [...prev.misEnCause];
      newMecs.splice(index, 1);
      return {...prev, misEnCause: newMecs};
    });
  }, []);

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
          <div className="text-center p-4">Chargement...</div>
        </DialogContent>
      </Dialog>
    );
  }

  const servicesTags = getTagsByCategory('services');
  const infractionsTags = getTagsByCategory('infractions');
  const serviceTags = selectedTags.filter(tag => tag.category === 'services');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>Nouvelle enquête</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Numéro d'enquête</label>
            <Input
              placeholder="Numéro d'enquête"
              value={newEnqueteData.numero}
              onChange={(e) => {
                setNewEnqueteData(prev => ({
                  ...prev,
                  numero: e.target.value
                }));
              }}
              required
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-sm font-medium">Date de début</label>
                <Input
                  type="date"
                  value={newEnqueteData.dateDebut}
                  onChange={(e) => {
                    setNewEnqueteData(prev => ({
                      ...prev,
                      dateDebut: e.target.value
                    }));
                  }}
                  disabled={isEnqueteAVenir}
                  required={!isEnqueteAVenir}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`mt-6 ${isEnqueteAVenir ? 'text-green-600' : 'text-gray-400'}`}
                onClick={() => setIsEnqueteAVenir(!isEnqueteAVenir)}
              >
                <Clock className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Services d'enquête</h3>
            <div className="space-y-2">
              <Select
                value={serviceTags[0]?.value || ''}
                onChange={(e) => handleAddService(0, e.target.value)}
                required
              >
                <option value="">Sélectionner le service principal</option>
                {servicesTags.map((service) => (
                  <option key={service.id} value={service.value}>
                    {service.value}
                  </option>
                ))}
              </Select>

              <Select
                value={serviceTags[1]?.value || ''}
                onChange={(e) => handleAddService(1, e.target.value)}
              >
                <option value="">Service co-saisi (optionnel)</option>
                {servicesTags
                  .filter(service => service.value !== serviceTags[0]?.value)
                  .map((service) => (
                    <option key={service.id} value={service.value}>
                      {service.value}
                    </option>
                  ))}
              </Select>
            </div>

            {/* Affichage des services sélectionnés */}
            <div className="flex flex-wrap gap-2 mt-2">
              {serviceTags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="flex items-center">
                  {tag.value}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 ml-2"
                    onClick={() => handleRemoveTag(tag.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Type d'infractions</h3>
            <div className="space-y-2">
              <Select
                value=""
                onChange={(e) => handleAddInfraction(e.target.value)}
              >
                <option value="">Sélectionner un type d'infraction</option>
                {infractionsTags.map((infraction) => (
                  <option key={infraction.id} value={infraction.value}>
                    {infraction.value}
                  </option>
                ))}
              </Select>

              <div className="flex flex-wrap gap-2 mt-2">
                {selectedTags
                  .filter(tag => tag.category === 'infractions')
                  .map(tag => (
                    <Badge key={tag.id} variant="secondary" className="flex items-center">
                      {tag.value}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 ml-2"
                        onClick={() => handleRemoveTag(tag.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Directeur d'enquête</label>
              <Input
                placeholder="Nom du directeur d'enquête"
                value={newEnqueteData.directeurEnquete || ''}
                onChange={(e) => setNewEnqueteData(prev => ({ ...prev, directeurEnquete: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Numéro parquet</label>
              <Input
                placeholder="Numéro de parquet"
                value={newEnqueteData.numeroParquet || ''}
                onChange={(e) => setNewEnqueteData(prev => ({ ...prev, numeroParquet: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Description des faits</label>
            <textarea
              className="w-full min-h-[100px] p-2 border rounded"
              placeholder="Description de l'affaire..."
              value={newEnqueteData.description}
              onChange={(e) => setNewEnqueteData(prev => ({
                ...prev,
                description: e.target.value
              }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Mis en cause</label>
            <div className="space-y-2 mt-1">
              <div className="flex gap-2">
                <MecAutocompleteInput
                  placeholder="Nom du MEC"
                  value={newMecName}
                  onChange={setNewMecName}
                  suggestions={allKnownMec}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddMec(); } }}
                />
                <Input
                  placeholder="Rôle (optionnel)"
                  value={newMecRole}
                  onChange={(e) => setNewMecRole(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddMec(); } }}
                />
                <Button type="button" onClick={handleAddMec} disabled={!newMecName.trim()}>
                  Ajouter
                </Button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {newEnqueteData.misEnCause.map((mec, index) => (
                <Badge key={mec.id} variant="secondary" className="flex items-center gap-1">
                  <span className="font-medium">{mec.nom}</span>
                  {mec.role && <span className="text-xs opacity-70">– {mec.role}</span>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 ml-1"
                    onClick={() => handleRemoveMec(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};