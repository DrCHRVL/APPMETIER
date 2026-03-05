"use client"

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Edit2, Save, X, Plus, Check, Trash2, AlertTriangle } from 'lucide-react';
import { TAG_CATEGORIES, TagCategory } from '@/config/tags';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ServiceOrganizer } from '../ServiceOrganizer';
import { useTags } from '@/hooks/useTags';
import { useToast } from '@/contexts/ToastContext';

interface EditingTag {
  id: string;
  category: TagCategory;
  originalValue: string;
  newValue: string;
}

export const TagManagementPage = () => {
  const { showToast } = useToast();
  
  const {
    tags,
    isLoading,
    getTagsByCategory,
    addTag,
    updateTag,
    deleteTag,
    cleanupOrphanTags,
    recreateOrphanTags
  } = useTags();

  const [editingCategory, setEditingCategory] = useState<TagCategory | null>(null);
  const [editingTag, setEditingTag] = useState<EditingTag | null>(null);
  const [newTagDialog, setNewTagDialog] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [orphanCleanupDialog, setOrphanCleanupDialog] = useState(false);
  const [foundOrphans, setFoundOrphans] = useState<string[]>([]);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTag && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTag]);

  const getPlaceholder = (category: TagCategory) => {
    switch (category) {
      case 'services':
        return 'Nom du nouveau service d\'enquête';
      case 'infractions':
        return 'Nouveau type d\'infraction';
      case 'duree':
        return 'Nouvelle durée';
      default:
        return 'Nom du tag';
    }
  };

  const handleCleanupOrphans = async () => {
    try {
      setIsCleaningUp(true);
      const { found } = await cleanupOrphanTags();
      
      if (found.length > 0) {
        setFoundOrphans(found);
        setOrphanCleanupDialog(true);
      } else {
        showToast('Aucun tag orphelin trouvé', 'info');
      }
    } catch (error) {
      console.error('Erreur lors du nettoyage:', error);
      showToast('Erreur lors du nettoyage des tags orphelins', 'error');
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleRecreateOrphans = async () => {
    try {
      const recreated = await recreateOrphanTags(foundOrphans);
      setOrphanCleanupDialog(false);
      setFoundOrphans([]);
      
      if (recreated > 0) {
        showToast(`${recreated} tags orphelins recréés avec succès`, 'success');
      } else {
        showToast('Aucun tag n\'a pu être recréé', 'warning');
      }
    } catch (error) {
      console.error('Erreur lors de la recréation:', error);
      showToast('Erreur lors de la recréation des tags', 'error');
    }
  };

  const handleStartEdit = (category: TagCategory) => {
    setEditingCategory(category);
  };

  const handleSaveEdit = (category: TagCategory) => {
    setEditingCategory(null);
    showToast('Modifications enregistrées', 'success');
  };

  const handleStartTagEdit = (tag: any, category: TagCategory) => {
    setEditingTag({
      id: tag.id,
      category,
      originalValue: tag.value,
      newValue: tag.value
    });
  };

  const handleSaveTagEdit = async () => {
    if (!editingTag) return;

    const { id, newValue } = editingTag;
    
    if (newValue.trim() === '') {
      showToast('Le nom du tag ne peut pas être vide', 'error');
      return;
    }

    if (newValue.trim() === editingTag.originalValue) {
      setEditingTag(null);
      return;
    }

    try {
      const success = await updateTag(id, { value: newValue.trim() });
      
      if (success) {
        setEditingTag(null);
        showToast(`Tag "${editingTag.originalValue}" renommé en "${newValue.trim()}"`, 'success');
      } else {
        showToast('Erreur lors de la modification du tag', 'error');
      }
    } catch (error) {
      console.error('Erreur lors de la modification du tag:', error);
      showToast('Erreur lors de la modification du tag', 'error');
    }
  };

  const handleCancelTagEdit = () => {
    setEditingTag(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTagEdit();
    } else if (e.key === 'Escape') {
      handleCancelTagEdit();
    }
  };

  const handleAddTag = async (category: TagCategory, customTagValue?: string) => {
    const tagToAdd = customTagValue || newTag.trim();
    if (!tagToAdd) return;

    if (category === 'duree') {
      if (!tagToAdd.startsWith('enquête de plus de') && tagToAdd !== 'enquête à venir') {
        showToast('Le tag de durée doit commencer par "enquête de plus de" ou être "enquête à venir"', 'error');
        return;
      }

      if (tagToAdd !== 'enquête à venir' && !tagToAdd.includes('jours') && !newDuration) {
        showToast('Veuillez spécifier une durée', 'error');
        return;
      }
    }

    try {
      const newTagData = {
        value: tagToAdd,
        category,
        isCustom: true
      };

      const success = await addTag(newTagData);
      
      if (success) {
        setNewTag('');
        setNewDuration('');
        setNewTagDialog(false);
        showToast('Tag ajouté avec succès', 'success');
      } else {
        showToast('Erreur lors de l\'ajout du tag', 'error');
      }
    } catch (error) {
      console.error('Erreur lors de l\'ajout du tag:', error);
      showToast('Erreur lors de l\'ajout du tag', 'error');
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      const success = await deleteTag(tagId);
      
      if (success) {
        showToast('Tag supprimé avec succès', 'success');
      } else {
        showToast('Erreur lors de la suppression du tag', 'error');
      }
    } catch (error) {
      console.error('Erreur lors de la suppression du tag:', error);
      showToast('Erreur lors de la suppression du tag', 'error');
    }
  };

  const renderTag = (tag: any, category: TagCategory) => {
    const isCurrentlyEditing = editingTag?.id === tag.id;

    if (isCurrentlyEditing) {
      return (
        <div key={tag.id} className="flex items-center">
          <div className="flex items-center gap-1 bg-white border rounded px-2 py-1">
            <Input
              ref={editInputRef}
              value={editingTag!.newValue}
              onChange={(e) => setEditingTag({
                ...editingTag!,
                newValue: e.target.value
              })}
              onKeyDown={handleEditKeyDown}
              className="h-6 text-xs w-40 px-1"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleSaveTagEdit}
            >
              <Check className="h-3 w-3 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleCancelTagEdit}
            >
              <X className="h-3 w-3 text-red-600" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div key={tag.id} className="flex items-center">
        <Badge
          variant="secondary"
          className="px-2 py-1 flex items-center gap-1 cursor-pointer hover:bg-gray-200 group"
          onDoubleClick={() => editingCategory === category && handleStartTagEdit(tag, category)}
        >
          {tag.value}
          {!tag.isCustom && <span className="text-xs text-blue-600 ml-1">•</span>}
          {editingCategory === category && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 hover:bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartTagEdit(tag, category);
                }}
                title="Éditer ce tag"
              >
                <Edit2 className="h-3 w-3 text-blue-600" />
              </Button>
              {tag.isCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveTag(tag.id);
                  }}
                  title="Supprimer ce tag"
                >
                  <X className="h-3 w-3 text-red-600" />
                </Button>
              )}
            </>
          )}
        </Badge>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="text-center">Chargement des tags...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Gestion des Tags</h2>
        
        <Button
          onClick={handleCleanupOrphans}
          disabled={isCleaningUp}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          {isCleaningUp ? 'Analyse...' : 'Nettoyer tags orphelins'}
        </Button>
      </div>

      <Tabs defaultValue="categories" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="categories">Tags par catégories</TabsTrigger>
          <TabsTrigger value="organization">Organisation des services</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4">
          {(Object.keys(TAG_CATEGORIES) as TagCategory[]).filter(category => category !== 'priorite').map(category => {
            const categoryTags = getTagsByCategory(category);
            
            return (
              <Card key={category} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between py-4">
                  <CardTitle className="text-lg">{TAG_CATEGORIES[category]}</CardTitle>
                  <div className="flex gap-2">
                    {editingCategory === category ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSaveEdit(category)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingCategory(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(category)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {editingCategory === category && (
                    <div className="mb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNewTagDialog(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Ajouter un tag
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {categoryTags.map((tag) => renderTag(tag, category))}
                  </div>
                  {editingCategory === category && (
                    <p className="text-xs text-gray-500 mt-2">
                      Double-cliquez sur un tag pour le modifier.
                      <br />• = Tag prédéfini (non supprimable)
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="organization" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Organisation des services par sections</CardTitle>
              <p className="text-sm text-gray-600">
                Organisez vos services d'enquête en sections pour un affichage structuré sur la grille principale.
              </p>
            </CardHeader>
            <CardContent>
              <ServiceOrganizer />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog pour les nouveaux tags */}
      <Dialog open={newTagDialog} onOpenChange={setNewTagDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory && `Ajouter un nouveau ${TAG_CATEGORIES[editingCategory].toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {editingCategory === 'duree' ? (
              <>
                <div>
                  <label className="text-sm font-medium">Type de tag</label>
                  <select
                    className="w-full mt-1 rounded-md border border-gray-300 p-2"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                  >
                    <option value="">Sélectionner un type</option>
                    <option value="enquête à venir">Enquête à venir</option>
                    <option value="enquête de plus de">Enquête de plus de</option>
                  </select>
                </div>
                {newTag === 'enquête de plus de' && (
                  <div>
                    <label className="text-sm font-medium">Durée (en jours)</label>
                    <Input
                      type="number"
                      min="1"
                      value={newDuration}
                      onChange={(e) => setNewDuration(e.target.value)}
                      placeholder="Nombre de jours"
                    />
                  </div>
                )}
              </>
            ) : (
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder={editingCategory ? getPlaceholder(editingCategory) : ''}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTagDialog(false)}>
              Annuler
            </Button>
            <Button 
              onClick={() => {
                if (editingCategory === 'duree' && newTag === 'enquête de plus de') {
                  const completeTag = `${newTag} ${newDuration} jours`;
                  handleAddTag(editingCategory, completeTag);
                } else {
                  handleAddTag(editingCategory!);
                }
              }}
            >
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog pour les tags orphelins */}
      <Dialog open={orphanCleanupDialog} onOpenChange={setOrphanCleanupDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Tags orphelins détectés
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {foundOrphans.length} tag(s) sont utilisé(s) dans vos enquêtes mais n'existent plus dans la gestion centralisée :
            </p>
            
            <div className="max-h-60 overflow-y-auto border rounded p-3 bg-gray-50">
              <div className="flex flex-wrap gap-2">
                {foundOrphans.map((orphanTag, index) => (
                  <Badge key={index} variant="outline" className="text-orange-700 border-orange-300">
                    {orphanTag}
                  </Badge>
                ))}
              </div>
            </div>
            
            <p className="text-sm text-blue-600">
              Ces tags seront recréés automatiquement avec une catégorie devinée en fonction de leur nom.
            </p>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setOrphanCleanupDialog(false);
                setFoundOrphans([]);
              }}
            >
              Ignorer
            </Button>
            <Button onClick={handleRecreateOrphans}>
              Recréer {foundOrphans.length} tag(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};