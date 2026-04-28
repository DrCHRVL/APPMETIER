"use client"

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Edit2, Save, X, Plus, Check, Trash2, AlertTriangle, Send, Layers, GitMerge } from 'lucide-react';
import { TAG_CATEGORIES, TagCategory } from '@/config/tags';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ServiceOrganizer } from '../ServiceOrganizer';
import { useTags, DuplicateTagGroup } from '@/hooks/useTags';
import { useToast } from '@/contexts/ToastContext';
import { useUser } from '@/contexts/UserContext';
import { tagRequestManager } from '@/utils/tagRequestManager';

interface EditingTag {
  id: string;
  category: TagCategory;
  originalValue: string;
  newValue: string;
}

export const TagManagementPage = () => {
  const { showToast } = useToast();
  const { isAdmin: checkIsAdmin, user } = useUser();
  const userIsAdmin = checkIsAdmin();
  const [requestTagDialog, setRequestTagDialog] = useState(false);
  const [requestTagValue, setRequestTagValue] = useState('');
  const [requestTagCategory, setRequestTagCategory] = useState<'services' | 'infractions'>('services');

  const handleRequestTag = async () => {
    if (!requestTagValue.trim() || !user) return;
    try {
      await tagRequestManager.addRequest({
        tagValue: requestTagValue.trim(),
        category: requestTagCategory,
        contentieuxId: '', // global
        requestedBy: user.displayName || user.windowsUsername,
      });
      showToast('Demande de tag envoyée à l\'administrateur', 'success');
      setRequestTagValue('');
      setRequestTagDialog(false);
    } catch {
      showToast('Erreur lors de l\'envoi de la demande', 'error');
    }
  };
  
  const {
    tags,
    isLoading,
    getTagsByCategory,
    addTag,
    updateTag,
    deleteTag,
    mergeTags,
    getTagUsageCount,
    cleanupOrphanTags,
    recreateOrphanTags,
    findDuplicateTags,
    mergeDuplicateTags
  } = useTags();

  const [editingCategory, setEditingCategory] = useState<TagCategory | null>(null);
  const [editingTag, setEditingTag] = useState<EditingTag | null>(null);
  const [newTagDialog, setNewTagDialog] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [orphanCleanupDialog, setOrphanCleanupDialog] = useState(false);
  const [foundOrphans, setFoundOrphans] = useState<string[]>([]);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [duplicatesDialog, setDuplicatesDialog] = useState(false);
  const [foundDuplicates, setFoundDuplicates] = useState<DuplicateTagGroup[]>([]);
  const [isMergingDuplicates, setIsMergingDuplicates] = useState(false);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ tagId: string; tagValue: string; usageCount: number } | null>(null);
  const [mergeDialog, setMergeDialog] = useState<{
    sourceId: string;
    sourceValue: string;
    category: TagCategory;
    targetId: string;
    usageCount: number | null;
  } | null>(null);
  const [isMergingTag, setIsMergingTag] = useState(false);
  
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTag && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTag?.id]);

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

  const handleScanDuplicates = () => {
    const groups = findDuplicateTags();
    if (groups.length === 0) {
      showToast('Aucun doublon détecté', 'info');
      return;
    }
    setFoundDuplicates(groups);
    setDuplicatesDialog(true);
  };

  const handleConfirmMergeDuplicates = async () => {
    try {
      setIsMergingDuplicates(true);
      const removed = await mergeDuplicateTags();
      setDuplicatesDialog(false);
      setFoundDuplicates([]);
      if (removed > 0) {
        showToast(`${removed} doublon(s) fusionné(s) avec succès`, 'success');
      } else {
        showToast('Aucun doublon à fusionner', 'info');
      }
    } catch (error) {
      console.error('Erreur lors de la fusion des doublons:', error);
      showToast('Erreur lors de la fusion des doublons', 'error');
    } finally {
      setIsMergingDuplicates(false);
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
        category
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
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;

    const usageCount = await getTagUsageCount(tag.value, tag.category);

    if (usageCount > 0) {
      setDeleteConfirmDialog({ tagId, tagValue: tag.value, usageCount });
    } else {
      await confirmDeleteTag(tagId);
    }
  };

  const handleStartMergeTag = async (tag: any, category: TagCategory) => {
    const usageCount = await getTagUsageCount(tag.value, category);
    setMergeDialog({
      sourceId: tag.id,
      sourceValue: tag.value,
      category,
      targetId: '',
      usageCount,
    });
  };

  const handleConfirmMergeTag = async () => {
    if (!mergeDialog || !mergeDialog.targetId) return;
    try {
      setIsMergingTag(true);
      const impacted = await mergeTags(mergeDialog.sourceId, mergeDialog.targetId);
      if (impacted < 0) {
        showToast('Erreur lors de la fusion du tag', 'error');
        return;
      }
      const targetTag = tags.find(t => t.id === mergeDialog.targetId);
      const targetLabel = targetTag?.value ?? mergeDialog.targetId;
      showToast(
        `Tag "${mergeDialog.sourceValue}" fusionné dans "${targetLabel}" — ${impacted} enquête(s) mise(s) à jour`,
        'success',
      );
      setMergeDialog(null);
    } catch (error) {
      console.error('Erreur lors de la fusion du tag:', error);
      showToast('Erreur lors de la fusion du tag', 'error');
    } finally {
      setIsMergingTag(false);
    }
  };

  const confirmDeleteTag = async (tagId: string) => {
    try {
      const success = await deleteTag(tagId);

      if (success) {
        setDeleteConfirmDialog(null);
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
              {userIsAdmin && getTagsByCategory(category).length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 hover:bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartMergeTag(tag, category);
                  }}
                  title="Fusionner ce tag dans un autre"
                >
                  <GitMerge className="h-3 w-3 text-purple-600" />
                </Button>
              )}
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

        {userIsAdmin ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleScanDuplicates}
              disabled={isMergingDuplicates}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Layers className="h-4 w-4" />
              Fusionner les doublons
            </Button>
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
        ) : (
          <Button
            onClick={() => {
              setRequestTagCategory('services');
              setRequestTagValue('');
              setRequestTagDialog(true);
            }}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Proposer un nouveau tag
          </Button>
        )}
      </div>

      <Tabs defaultValue="categories" className="w-full">
        <TabsList className={`grid w-full ${userIsAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <TabsTrigger value="categories">Tags par catégories</TabsTrigger>
          {userIsAdmin && (
            <TabsTrigger value="organization">Organisation des services</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="categories" className="space-y-4">
          {(Object.keys(TAG_CATEGORIES) as TagCategory[]).filter(category => category !== 'suivi').map(category => {
            const categoryTags = getTagsByCategory(category);

            return (
              <Card key={category} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between py-4">
                  <CardTitle className="text-lg">{TAG_CATEGORIES[category]}</CardTitle>
                  {/* Contrôles d'édition : admin uniquement.
                      Les non-admins passent par le bouton "Proposer un nouveau tag" du header. */}
                  {userIsAdmin && (
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
                  )}
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
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {userIsAdmin && (
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
        )}
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

      {/* Dialog pour la fusion des doublons */}
      <Dialog open={duplicatesDialog} onOpenChange={setDuplicatesDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-500" />
              Doublons détectés
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {foundDuplicates.length} valeur(s) existent plusieurs fois. La fusion conservera
              un seul tag par valeur (en priorité celui qui a déjà une section assignée) et
              transférera l'organisation si nécessaire.
            </p>

            <div className="max-h-72 overflow-y-auto border rounded p-3 bg-gray-50">
              <ul className="space-y-1 text-sm">
                {foundDuplicates.map((g, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <Badge variant="outline" className="mr-2">
                        {TAG_CATEGORIES[g.category] || g.category}
                      </Badge>
                      <span className="font-medium">{g.value}</span>
                    </span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {g.count} → 1 ({g.removedCount} supprimé{g.removedCount > 1 ? 's' : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-gray-500">
              Les enquêtes référencent les tags par leur nom : la fusion n'impactera pas les
              enquêtes existantes.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDuplicatesDialog(false);
                setFoundDuplicates([]);
              }}
              disabled={isMergingDuplicates}
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmMergeDuplicates}
              disabled={isMergingDuplicates}
            >
              {isMergingDuplicates
                ? 'Fusion...'
                : `Fusionner (${foundDuplicates.reduce((sum, g) => sum + g.removedCount, 0)} suppression(s))`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog demande de tag (non-admin) */}
      <Dialog open={requestTagDialog} onOpenChange={setRequestTagDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Demander la création d'un tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Votre demande sera envoyée à l'administrateur pour validation.
            </p>
            <div>
              <label className="text-sm font-medium">Catégorie</label>
              <select
                className="w-full mt-1 rounded-md border border-gray-300 p-2 text-sm"
                value={requestTagCategory}
                onChange={(e) => setRequestTagCategory(e.target.value as 'services' | 'infractions')}
              >
                <option value="services">Service d'enquête</option>
                <option value="infractions">Type d'infraction</option>
              </select>
            </div>
            <Input
              value={requestTagValue}
              onChange={(e) => setRequestTagValue(e.target.value)}
              placeholder="Nom du tag souhaité"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestTagDialog(false)}>
              Annuler
            </Button>
            <Button onClick={handleRequestTag} disabled={!requestTagValue.trim()}>
              <Send className="h-4 w-4 mr-2" />
              Envoyer la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de fusion d'un tag dans un autre */}
      <Dialog open={!!mergeDialog} onOpenChange={() => !isMergingTag && setMergeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5 text-purple-600" />
              Fusionner « {mergeDialog?.sourceValue} »
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Toutes les enquêtes utilisant <strong>« {mergeDialog?.sourceValue} »</strong>{' '}
              {mergeDialog?.usageCount !== null && (
                <span className="text-gray-500">({mergeDialog?.usageCount} enquête(s)) </span>
              )}
              recevront le tag cible à la place. Le tag <strong>« {mergeDialog?.sourceValue} »</strong>{' '}
              sera ensuite supprimé de la gestion centrale.
            </p>
            <div>
              <label className="text-sm font-medium">Tag cible</label>
              <select
                className="w-full mt-1 rounded-md border border-gray-300 p-2 text-sm"
                value={mergeDialog?.targetId ?? ''}
                onChange={(e) =>
                  mergeDialog && setMergeDialog({ ...mergeDialog, targetId: e.target.value })
                }
                disabled={isMergingTag}
              >
                <option value="">— Sélectionner un tag —</option>
                {mergeDialog && getTagsByCategory(mergeDialog.category)
                  .filter(t => t.id !== mergeDialog.sourceId)
                  .sort((a, b) => a.value.localeCompare(b.value))
                  .map(t => (
                    <option key={t.id} value={t.id}>{t.value}</option>
                  ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">
              La fusion est irréversible et limitée aux tags de la même catégorie.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeDialog(null)}
              disabled={isMergingTag}
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmMergeTag}
              disabled={!mergeDialog?.targetId || isMergingTag}
            >
              {isMergingTag ? 'Fusion...' : 'Fusionner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmation de suppression */}
      <Dialog open={!!deleteConfirmDialog} onOpenChange={() => setDeleteConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Confirmer la suppression
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              Le tag <strong>"{deleteConfirmDialog?.tagValue}"</strong> est utilisé dans{' '}
              <strong>{deleteConfirmDialog?.usageCount} enquête(s) / instruction(s)</strong>.
            </p>
            <p className="text-sm text-red-600">
              La suppression retirera ce tag de toutes les enquêtes et instructions concernées.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmDialog(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmDialog && confirmDeleteTag(deleteConfirmDialog.tagId)}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};