import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Plus, Settings, Save, X } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useToast } from '@/contexts/ToastContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

interface TagOrganization {
  section: string;
  subsection?: string;
  order: number;
}

const SECTIONS_ORDER = [
  'SR',
  'DCOS80',
  'Offices centraux',
  'Brigade de recherches Peronne',
  'Brigade de recherches Amiens',
  'Brigade de recherches Abbeville',
  'Brigade de recherches Montdidier',
  'SLPJ Amiens',
  'Compagnie de Amiens',
  'Compagnie de Abbeville',
  'Compagnie de Peronne',
  'Compagnie de Montdidier'
];

export const ServiceOrganizer = () => {
  const { showToast } = useToast();
  
  const {
    tags,
    getTagsByCategory,
    updateTagOrganization,
    isLoading
  } = useTags();

  const [newSectionDialog, setNewSectionDialog] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [customSections, setCustomSections] = useState<string[]>([]);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingOrganization, setEditingOrganization] = useState<TagOrganization | null>(null);

  const serviceTags = getTagsByCategory('services');

  // Organiser les tags par section
  const tagsBySection = useMemo(() => {
    const organized: { [section: string]: any[] } = {};
    const unorganized: any[] = [];

    serviceTags.forEach(tag => {
      if (tag.organization?.section) {
        const section = tag.organization.section;
        if (!organized[section]) organized[section] = [];
        organized[section].push(tag);
      } else {
        unorganized.push(tag);
      }
    });

    // Ajouter les tags non organisés
    if (unorganized.length > 0) {
      organized['NON ORGANISÉS'] = unorganized;
    }

    return organized;
  }, [serviceTags]);

  // Obtenir toutes les sections disponibles
  const availableSections = useMemo(() => {
    const usedSections = new Set(Object.keys(tagsBySection).filter(s => s !== 'NON ORGANISÉS'));
    const allSections = [...new Set([...SECTIONS_ORDER, ...customSections, ...usedSections])];
    return allSections;
  }, [tagsBySection, customSections]);

  // Fonction pour obtenir l'ordre d'une section
  const getSectionOrder = (sectionName: string) => {
    const orderIndex = SECTIONS_ORDER.indexOf(sectionName);
    if (orderIndex !== -1) return orderIndex;
    
    const customIndex = customSections.indexOf(sectionName);
    if (customIndex !== -1) return SECTIONS_ORDER.length + customIndex;
    
    if (sectionName === 'NON ORGANISÉS') return 9999; // Toujours en dernier
    
    return SECTIONS_ORDER.length + customSections.length; // Autres sections
  };

  const handleStartEditTag = (tag: any) => {
    setEditingTag(tag.id);
    setEditingOrganization(tag.organization || { section: '', order: 0 });
  };

  const handleSaveTagOrganization = async () => {
    if (!editingTag || !editingOrganization) return;

    if (!editingOrganization.section.trim()) {
      // Supprimer l'organisation
      const success = await updateTagOrganization(editingTag, null);
      if (success) {
        showToast('Tag retiré de l\'organisation', 'success');
      } else {
        showToast('Erreur lors de la modification', 'error');
      }
    } else {
      // Mettre à jour l'organisation
      const success = await updateTagOrganization(editingTag, editingOrganization);
      if (success) {
        showToast('Organisation mise à jour', 'success');
      } else {
        showToast('Erreur lors de la modification', 'error');
      }
    }

    setEditingTag(null);
    setEditingOrganization(null);
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditingOrganization(null);
  };

  const handleQuickAssign = async (tagId: string, section: string) => {
    const organization: TagOrganization = {
      section
    };

    const success = await updateTagOrganization(tagId, organization);
    if (success) {
      showToast(`Tag assigné à ${section}`, 'success');
    } else {
      showToast('Erreur lors de l\'assignation', 'error');
    }
  };

  const handleCreateSection = () => {
    if (newSectionName.trim()) {
      setCustomSections(prev => [...prev, newSectionName.trim()]);
      showToast(`Section "${newSectionName.trim()}" ajoutée`, 'success');
      setNewSectionName('');
      setNewSectionDialog(false);
    }
  };

  const renderTagCard = (tag: any, section: string) => {
    const isEditing = editingTag === tag.id;

    if (isEditing) {
      return (
        <Card key={tag.id} className="border-2 border-blue-300">
          <CardContent className="p-3">
            <div className="space-y-3">
              <div className="font-medium">{tag.value}</div>
              
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium">Section</label>
                  <Select
                    value={editingOrganization?.section || ''}
                    onChange={(e) => setEditingOrganization(prev => ({
                      ...prev!,
                      section: e.target.value
                    }))}
                    className="w-full"
                  >
                    <option value="">Aucune section</option>
                    {availableSections.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveTagOrganization}>
                  <Save className="h-3 w-3 mr-1" />
                  Enregistrer
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  <X className="h-3 w-3 mr-1" />
                  Annuler
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card key={tag.id} className="hover:shadow-md transition-shadow">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-sm">{tag.value}</div>
            </div>
            
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => handleStartEditTag(tag)}
              >
                <Settings className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return <div className="text-center">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button onClick={() => setNewSectionDialog(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle section
        </Button>
        <span className="text-sm text-gray-600">
          {serviceTags.length} services au total
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(tagsBySection)
          .sort(([a], [b]) => getSectionOrder(a) - getSectionOrder(b))
          .map(([section, sectionTags]) => (
            <Card key={section} className="min-h-[200px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className={section === 'NON ORGANISÉS' ? 'text-orange-600' : ''}>
                    {section} ({sectionTags.length})
                  </span>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-2">
                {sectionTags
                  .sort((a, b) => a.value.localeCompare(b.value))
                  .map(tag => renderTagCard(tag, section))
                }
                
                {sectionTags.length === 0 && (
                  <div className="text-center text-gray-400 py-8 text-sm">
                    Aucun service
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        }
      </div>

      {/* Dialog pour nouvelle section */}
      <Dialog open={newSectionDialog} onOpenChange={setNewSectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer une nouvelle section</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Input
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Nom de la section"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateSection();
                }
              }}
            />
            <p className="text-sm text-gray-600">
              Cette section sera disponible pour organiser vos services.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSectionDialog(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateSection}>
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};