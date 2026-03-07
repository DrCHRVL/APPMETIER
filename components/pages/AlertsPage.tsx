import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { AlertRule, WeeklyPopupConfig } from '@/types/interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select } from '../ui/select';
import { Edit2, Save, X, Plus, Copy, Clock } from 'lucide-react';
import { AlertValidation } from '@/utils/alerts/alertValidation';
import { ElectronBridge } from '@/utils/electronBridge';

const WEEKLY_POPUP_KEY = 'weekly_popup_config';
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

interface AlertsPageProps {
  rules: AlertRule[];
  onUpdateRule: (rule: AlertRule) => void;
  onDuplicateRule: (rule: AlertRule) => void;
  onDeleteRule: (ruleId: number) => void;
}

export const AlertsPage = ({ rules, onUpdateRule, onDuplicateRule, onDeleteRule }: AlertsPageProps) => {
  const [weeklyConfig, setWeeklyConfig] = useState<WeeklyPopupConfig>({
    enabled: false,
    dayOfWeek: 1, // Lundi
    hour: 9
  });

  useEffect(() => {
    ElectronBridge.getData<WeeklyPopupConfig>(WEEKLY_POPUP_KEY, {
      enabled: false, dayOfWeek: 1, hour: 9
    }).then(cfg => setWeeklyConfig(cfg));
  }, []);

  const saveWeeklyConfig = (cfg: WeeklyPopupConfig) => {
    setWeeklyConfig(cfg);
    ElectronBridge.setData(WEEKLY_POPUP_KEY, cfg);
  };

  const [showNewRuleDialog, setShowNewRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [newRule, setNewRule] = useState<Partial<AlertRule>>({
    type: 'cr_delay',
    name: '',
    description: '',
    threshold: 7,
    enabled: true,
    acteType: 'all',
    recurrence: {
      enabled: false,
      defaultInterval: 7,
      maxOccurrences: undefined
    }
  });

  const getTypeLabel = (type: AlertRule['type']) => {
    switch (type) {
      case 'cr_delay':
        return 'Délai compte rendu';
      case 'acte_expiration':
        return 'Expiration acte';
      case 'enquete_age':
        return 'Âge enquête';
      case 'prolongation_pending':
        return 'Prolongation en attente';
      case 'air_6_mois':
        return 'Mesure AIR > 6 mois';
      case 'air_12_mois':
        return 'Mesure AIR > 12 mois';
      case 'air_rdv_delai':
        return 'Délai depuis RDV AIR';
      default:
        return type;
    }
  };

  // Déplacer la fonction getDescription ici, avant son utilisation
  const getDescription = (rule: AlertRule) => {
    let baseDescription = '';
    
    switch (rule.type) {
      case 'cr_delay':
        baseDescription = `Alerte lorsqu'aucun compte rendu n'a été ajouté depuis ${rule.threshold} jours`;
        break;
      case 'acte_expiration':
        baseDescription = `Alerte lorsqu'un ${rule.acteType === 'all' ? 'acte' : rule.acteType} arrive à expiration dans ${rule.threshold} jours`;
        break;
      case 'enquete_age':
        baseDescription = `Alerte lorsqu'une enquête atteint ${rule.threshold} jours`;
        break;
      case 'prolongation_pending':
        baseDescription = `Alerte pour relancer le JLD après ${rule.threshold} jours d'attente`;
        break;
      case 'air_6_mois':
        baseDescription = `Alerte lorsqu'une mesure AIR dépasse 6 mois`;
        break;
      case 'air_12_mois':
        baseDescription = `Alerte lorsqu'une mesure AIR dépasse 12 mois`;
        break;
      case 'air_rdv_delai':
        baseDescription = `Alerte lorsqu'aucun RDV procureur n'a eu lieu depuis ${rule.threshold} jours`;
        break;
      default:
        baseDescription = rule.description || '';
        break;
    }
    
    // Ajouter les infos de récurrence si activée
    if (rule.recurrence?.enabled) {
      baseDescription += ` (récurrence tous les ${rule.recurrence.defaultInterval} jours`;
      if (rule.recurrence.maxOccurrences) {
        baseDescription += `, max. ${rule.recurrence.maxOccurrences} fois`;
      }
      baseDescription += ')';
    }
    
    return baseDescription;
  };

  const handleToggleRule = (rule: AlertRule) => {
    onUpdateRule({
      ...rule,
      enabled: !rule.enabled
    });
  };

  const handleToggleRecurrence = (rule: AlertRule, enabled: boolean) => {
    onUpdateRule({
      ...rule,
      recurrence: {
        ...rule.recurrence || { defaultInterval: 7 },
        enabled
      }
    });
  };

  const handleSaveEdit = () => {
    if (editingRule) {
      const updatedRule = {
        ...editingRule,
        description: getDescription(editingRule)
      };

      if (AlertValidation.validateRule(updatedRule)) {
        onUpdateRule(updatedRule);
        setEditingRule(null);
      } else {
        alert('Veuillez remplir tous les champs requis');
      }
    }
  };

  const handleCreateRule = () => {
    if (!newRule.type || !newRule.threshold) {
      alert('Veuillez remplir tous les champs requis');
      return;
    }

    const rule: AlertRule = {
      id: Date.now(),
      type: newRule.type,
      name: newRule.name || getTypeLabel(newRule.type),
      description: getDescription(newRule as AlertRule),
      threshold: newRule.threshold,
      enabled: true,
      acteType: newRule.acteType || 'all',
      recurrence: newRule.recurrence
    };

    if (AlertValidation.validateRule(rule)) {
      onUpdateRule(rule);
      setShowNewRuleDialog(false);
      setNewRule({
        type: 'cr_delay',
        name: '',
        description: '',
        threshold: 7,
        enabled: true,
        acteType: 'all',
        recurrence: {
          enabled: false,
          defaultInterval: 7,
          maxOccurrences: undefined
        }
      });
    } else {
      alert('Veuillez remplir tous les champs requis');
    }
  };

  const isSystemRule = (rule: AlertRule) => rule.isSystemRule;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Gestion des Alertes</h2>
        <Button onClick={() => setShowNewRuleDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle alerte
        </Button>
      </div>

      {/* Récapitulatif hebdomadaire */}
      <Card className="mb-6 border-blue-200 bg-blue-50">
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              Récapitulatif hebdomadaire
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Popup au démarrage qui liste les actes à surveiller et les enquêtes à relancer.
            </p>
          </div>
          <Switch
            checked={weeklyConfig.enabled}
            onCheckedChange={(v) => saveWeeklyConfig({ ...weeklyConfig, enabled: v })}
          />
        </CardHeader>
        {weeklyConfig.enabled && (
          <CardContent className="flex flex-wrap gap-4 items-center pb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Jour :</span>
              <Select
                value={String(weeklyConfig.dayOfWeek)}
                onChange={(e) => saveWeeklyConfig({ ...weeklyConfig, dayOfWeek: Number(e.target.value) })}
                className="h-8 text-sm w-36"
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Heure :</span>
              <Input
                type="number"
                min={0}
                max={23}
                value={weeklyConfig.hour}
                onChange={(e) => saveWeeklyConfig({ ...weeklyConfig, hour: Math.min(23, Math.max(0, Number(e.target.value))) })}
                className="h-8 text-sm w-20"
              />
              <span className="text-sm text-gray-600">h</span>
            </div>
            <p className="text-xs text-gray-400 w-full">
              S'affiche si l'app est ouverte après {weeklyConfig.hour}h00 le {DAYS[weeklyConfig.dayOfWeek]}.
              Les seuils utilisés sont ceux des règles "Délai compte rendu" et "Expiration acte".
            </p>
          </CardContent>
        )}
      </Card>

      <div className="space-y-4">
        {rules.map(rule => (
          <Card key={rule.id} className={`shadow-sm ${rule.isSystemRule ? 'border-green-200' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  {rule.name || getTypeLabel(rule.type)}
                  {rule.isSystemRule && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                      Système
                    </span>
                  )}
                  {rule.recurrence?.enabled && (
                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Récurrent
                    </span>
                  )}
                </CardTitle>
                <p className="text-sm text-gray-500">{getDescription(rule)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={() => handleToggleRule(rule)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDuplicateRule(rule)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {editingRule?.id === rule.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSaveEdit}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingRule(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingRule(rule)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    {!isSystemRule(rule) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => onDeleteRule(rule.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {editingRule?.id === rule.id && (
                <>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">Délai d'alerte:</span>
                    <Input
                      type="number"
                      min="1"
                      value={editingRule.threshold}
                      onChange={(e) => setEditingRule({
                        ...editingRule,
                        threshold: parseInt(e.target.value)
                      })}
                      className="w-24"
                    /> 
                    <span className="text-sm text-gray-600">jours</span>
                  </div>

                  {editingRule.type === 'acte_expiration' && (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-600">Type d'acte:</span>
                      <Select
                        value={editingRule.acteType || 'all'}
                        onChange={(e) => setEditingRule({
                          ...editingRule,
                          acteType: e.target.value
                        })}
                        className="w-40"
                      >
                        <option value="all">Tous les actes</option>
                        <option value="geolocalisation">Géolocalisation</option>
                        <option value="ecoute">Écoute</option>
                        <option value="autre">Autre acte</option>
                      </Select>
                    </div>
                  )}
                  
                  {/* Section de récurrence avec checkbox natif */}
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-4">
                      <input
                        type="checkbox"
                        id={`recurrence-${rule.id}`}
                        checked={editingRule.recurrence?.enabled || false}
                        onChange={(e) => setEditingRule({
                          ...editingRule,
                          recurrence: {
                            ...editingRule.recurrence || { defaultInterval: 7 },
                            enabled: e.target.checked
                          }
                        })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <label 
                        htmlFor={`recurrence-${rule.id}`}
                        className="text-sm font-medium"
                      >
                        Activer la récurrence
                      </label>
                    </div>
                    
                    {editingRule.recurrence?.enabled && (
                      <div className="space-y-3 pl-6">
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-gray-600">Répéter tous les:</span>
                          <Input
                            type="number"
                            min="1"
                            value={editingRule.recurrence?.defaultInterval || 7}
                            onChange={(e) => setEditingRule({
                              ...editingRule,
                              recurrence: {
                                ...editingRule.recurrence || {},
                                defaultInterval: parseInt(e.target.value) || 7
                              }
                            })}
                            className="w-24"
                          /> 
                          <span className="text-sm text-gray-600">jours</span>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-gray-600">Nombre maximum de répétitions:</span>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Illimité"
                            value={editingRule.recurrence?.maxOccurrences || ''}
                            onChange={(e) => {
                              const value = e.target.value.trim() === '' 
                                ? undefined 
                                : parseInt(e.target.value);
                              setEditingRule({
                                ...editingRule,
                                recurrence: {
                                  ...editingRule.recurrence || {},
                                  maxOccurrences: value
                                }
                              });
                            }}
                            className="w-24"
                          /> 
                          <span className="text-sm text-gray-600">fois (vide = illimité)</span>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showNewRuleDialog} onOpenChange={setShowNewRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle règle d'alerte</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Type d'alerte</label>
              <Select
                value={newRule.type}
                onChange={(e) => setNewRule(prev => ({
                  ...prev,
                  type: e.target.value as AlertRule['type']
                }))}
              >
                <option value="cr_delay">Délai compte rendu</option>
                <option value="acte_expiration">Expiration acte</option>
                <option value="enquete_age">Âge enquête</option>
                <option value="air_6_mois">Mesure AIR > 6 mois</option>
                <option value="air_12_mois">Mesure AIR > 12 mois</option>
                <option value="air_rdv_delai">Délai depuis RDV AIR</option>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Titre de l'alerte</label>
              <Input
                value={newRule.name}
                onChange={(e) => setNewRule(prev => ({
                  ...prev,
                  name: e.target.value
                }))}
                placeholder="Titre personnalisé (optionnel)"
              />
            </div>

            {newRule.type === 'acte_expiration' && (
              <div>
                <label className="text-sm font-medium">Type d'acte</label>
                <Select
                  value={newRule.acteType}
                  onChange={(e) => setNewRule(prev => ({
                    ...prev,
                    acteType: e.target.value
                  }))}
                >
                  <option value="all">Tous les actes</option>
                  <option value="geolocalisation">Géolocalisation</option>
                  <option value="ecoute">Écoute</option>
                  <option value="autre">Autre acte</option>
                </Select>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Délai (jours)</label>
              <Input
                type="number"
                min="1"
                value={newRule.threshold}
                onChange={(e) => setNewRule(prev => ({
                  ...prev,
                  threshold: parseInt(e.target.value)
                }))}
              />
            </div>
            
            {/* Section de récurrence avec checkbox natif */}
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="new-rule-recurrence" 
                  checked={newRule.recurrence?.enabled || false}
                  onChange={(e) => setNewRule(prev => ({
                    ...prev,
                    recurrence: {
                      ...prev.recurrence || { defaultInterval: 7 },
                      enabled: e.target.checked
                    }
                  }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label 
                  htmlFor="new-rule-recurrence"
                  className="text-sm font-medium"
                >
                  Activer la récurrence
                </label>
              </div>
              
              {newRule.recurrence?.enabled && (
                <div className="space-y-3 pl-6">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">Répéter tous les:</span>
                    <Input
                      type="number"
                      min="1"
                      value={newRule.recurrence?.defaultInterval || 7}
                      onChange={(e) => setNewRule(prev => ({
                        ...prev,
                        recurrence: {
                          ...prev.recurrence || {},
                          defaultInterval: parseInt(e.target.value) || 7
                        }
                      }))}
                      className="w-24"
                    /> 
                    <span className="text-sm text-gray-600">jours</span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">Nombre maximum de répétitions:</span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Illimité"
                      value={newRule.recurrence?.maxOccurrences || ''}
                      onChange={(e) => {
                        const value = e.target.value.trim() === '' 
                          ? undefined 
                          : parseInt(e.target.value);
                        setNewRule(prev => ({
                          ...prev,
                          recurrence: {
                            ...prev.recurrence || {},
                            maxOccurrences: value
                          }
                        }));
                      }}
                      className="w-24"
                    /> 
                    <span className="text-sm text-gray-600">fois (vide = illimité)</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewRuleDialog(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateRule}>
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};