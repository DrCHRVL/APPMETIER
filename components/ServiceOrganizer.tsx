import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Plus, Settings, Save, X, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useSections } from '@/hooks/useSections';
import { useUserServiceOrganization } from '@/hooks/useUserServiceOrganization';
import { useToast } from '@/contexts/ToastContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { TagOrganization } from '@/config/tags';

export const ServiceOrganizer = () => {
  const { showToast } = useToast();

  const {
    getTagsByCategory,
    isLoading
  } = useTags();

  const {
    sections: savedSections,
    isLoading: sectionsLoading,
    addSection,
    removeSection,
    reorderSection,
    getSectionOrder
  } = useSections();

  const { getTagSection, setTagSection } = useUserServiceOrganization();

  const [newSectionDialog, setNewSectionDialog] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingOrganization, setEditingOrganization] = useState<TagOrganization | null>(null);

  const serviceTags = getTagsByCategory('services');

  // Organiser les tags par section d'après l'organisation PERSONNELLE de
  // l'utilisateur (user-preferences), et non l'ancienne `tag.organization`
  // globale qui était partagée par toute l'équipe.
  const tagsBySection = useMemo(() => {
    const organized: { [section: string]: any[] } = {};
    const unorganized: any[] = [];

    serviceTags.forEach(tag => {
      const section = getTagSection(tag.id);
      if (section) {
        if (!organized[section]) organized[section] = [];
        organized[section].push(tag);
      } else {
        unorganized.push(tag);
      }
    });

    if (unorganized.length > 0) {
      organized['NON ORGANISÉS'] = unorganized;
    }

    return organized;
  }, [serviceTags, getTagSection]);

  // Obtenir toutes les sections disponibles (sauvegardées + utilisées dans les tags)
  const availableSections = useMemo(() => {
    const usedSections = new Set(Object.keys(tagsBySection).filter(s => s !== 'NON ORGANISÉS'));
    const allSections = [...new Set([...savedSections, ...usedSections])];
    return allSections;
  }, [tagsBySection, savedSections]);

  const handleStartEditTag = (tag: any) => {
    setEditingTag(tag.id);
    const currentSection = getTagSection(tag.id) ?? '';
    setEditingOrganization({ section: currentSection });
  };

  const handleSaveTagOrganization = async () => {
    if (!editingTag || !editingOrganization) return;

    try {
      if (!editingOrganization.section.trim()) {
        await setTagSection(editingTag, null);
        showToast('Tag retiré de l\'organisation', 'success');
      } else {
        await setTagSection(editingTag, editingOrganization.section);
        showToast('Organisation mise à jour', 'success');
      }
    } catch (error) {
      console.error('Error updating tag organization:', error);
      showToast('Erreur lors de la modification', 'error');
    }

    setEditingTag(null);
    setEditingOrganization(null);
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditingOrganization(null);
  };

  const handleCreateSection = async () => {
    if (newSectionName.trim()) {
      const success = await addSection(newSectionName.trim());
      if (success) {
        showToast(`Section "${newSectionName.trim()}" ajoutée`, 'success');
      } else {
        showToast('Cette section existe déjà', 'warning');
      }
      setNewSectionName('');
      setNewSectionDialog(false);
    }
  };

  const handleRemoveSection = async (sectionName: string) => {
    await removeSection(sectionName);
    showToast(`Section "${sectionName}" supprimée`, 'success');
  };

  const handleReorderSection = async (sectionName: string, direction: 'up' | 'down') => {
    await reorderSection(sectionName, direction);
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

  if (isLoading || sectionsLoading) {
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
                  {section !== 'NON ORGANISÉS' && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleReorderSection(section, 'up')}
                        title="Monter"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleReorderSection(section, 'down')}
                        title="Descendre"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                        onClick={() => handleRemoveSection(section)}
                        title="Supprimer cette section"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
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