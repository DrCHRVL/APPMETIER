// components/ContentieuxAlertsBubble.tsx
//
// Bulle de configuration des alertes partagées d'un contentieux. Toutes les
// équipes qui travaillent sur le contentieux voient les mêmes règles ;
// chaque utilisateur décide via une case s'il veut recevoir les alertes
// qui en découlent dans sa cloche. L'édition des règles est réservée aux
// utilisateurs qui ont la permission `manage_alerts` (magistrat affecté
// au contentieux ou admin).

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select } from './ui/select';
import { Edit2, Save, X, Plus, Copy, Clock } from 'lucide-react';
import { AlertRule } from '@/types/interfaces';
import { AlertValidation } from '@/utils/alerts/alertValidation';
import { useContentieuxAlertRules } from '@/hooks/useContentieuxAlertRules';

interface Props {
  contentieuxId: string;
  contentieuxLabel: string;
  contentieuxColor?: string;
  canManage: boolean;
  isSubscribed: boolean;
  onToggleSubscription: () => void;
  userHasAIR: boolean;
}

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

const getDescription = (rule: AlertRule) => {
  let base = '';
  switch (rule.type) {
    case 'cr_delay':
      base = `Alerte lorsqu'aucun compte rendu n'a été ajouté depuis ${rule.threshold} jours`;
      break;
    case 'acte_expiration':
      base = `Alerte lorsqu'un ${rule.acteType === 'all' ? 'acte' : rule.acteType} arrive à expiration dans ${rule.threshold} jours`;
      break;
    case 'enquete_age':
      base = `Alerte lorsqu'une enquête atteint ${rule.threshold} jours`;
      break;
    case 'prolongation_pending':
      base = `Alerte pour relancer le JLD après ${rule.threshold} jours d'attente`;
      break;
    case 'air_6_mois':
      base = `Alerte lorsqu'une mesure AIR dépasse 6 mois`;
      break;
    case 'air_12_mois':
      base = `Alerte lorsqu'une mesure AIR dépasse 12 mois`;
      break;
    case 'air_rdv_delai':
      base = `Alerte lorsqu'aucun RDV procureur n'a eu lieu depuis ${rule.threshold} jours`;
      break;
    default:
      base = rule.description || '';
  }
  if (rule.recurrence?.enabled) {
    base += ` (récurrence tous les ${rule.recurrence.defaultInterval} jours`;
    if (rule.recurrence.maxOccurrences) base += `, max. ${rule.recurrence.maxOccurrences} fois`;
    base += ')';
  }
  return base;
};

export const ContentieuxAlertsBubble: React.FC<Props> = ({
  contentieuxId,
  contentieuxLabel,
  contentieuxColor,
  canManage,
  isSubscribed,
  onToggleSubscription,
  userHasAIR,
}) => {
  const { rules, updateRule, deleteRule, duplicateRule } = useContentieuxAlertRules(contentieuxId);

  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [showNewRuleDialog, setShowNewRuleDialog] = useState(false);
  const [newRule, setNewRule] = useState<Partial<AlertRule>>({
    type: 'cr_delay',
    name: '',
    description: '',
    threshold: 7,
    enabled: true,
    acteType: 'all',
    recurrence: { enabled: false, defaultInterval: 7, maxOccurrences: undefined },
  });

  const handleToggleRule = (rule: AlertRule) => {
    updateRule({ ...rule, enabled: !rule.enabled });
  };

  const handleSaveEdit = () => {
    if (!editingRule) return;
    const updated = { ...editingRule, description: getDescription(editingRule) };
    if (AlertValidation.validateRule(updated)) {
      updateRule(updated);
      setEditingRule(null);
    } else {
      alert('Les valeurs saisies ne sont pas valides');
    }
  };

  const handleCreateRule = () => {
    if (newRule.name && newRule.threshold) {
      const created: AlertRule = {
        id: Date.now(),
        type: (newRule.type || 'cr_delay') as AlertRule['type'],
        name: newRule.name,
        description: getDescription({ ...(newRule as AlertRule) }),
        threshold: newRule.threshold,
        enabled: newRule.enabled ?? true,
        acteType: newRule.acteType as AlertRule['acteType'],
        recurrence: newRule.recurrence,
        isSystemRule: false,
      };
      if (AlertValidation.validateRule(created)) {
        updateRule(created);
        setShowNewRuleDialog(false);
        setNewRule({
          type: 'cr_delay',
          name: '',
          description: '',
          threshold: 7,
          enabled: true,
          acteType: 'all',
          recurrence: { enabled: false, defaultInterval: 7, maxOccurrences: undefined },
        });
      } else {
        alert('Les valeurs saisies ne sont pas valides');
      }
    } else {
      alert('Veuillez remplir tous les champs requis');
    }
  };

  const visibleRules = rules.filter(rule => {
    if (!userHasAIR && ['air_6_mois', 'air_12_mois', 'air_rdv_delai'].includes(rule.type)) return false;
    return true;
  });

  const borderStyle = contentieuxColor ? { borderColor: contentieuxColor } : undefined;

  return (
    <Card className="mb-6 border-2" style={borderStyle}>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <div className="flex-1">
          <CardTitle
            className="text-lg flex items-center gap-2"
            style={contentieuxColor ? { color: contentieuxColor } : undefined}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={contentieuxColor ? { backgroundColor: contentieuxColor } : undefined}
            />
            Alertes du contentieux {contentieuxLabel}
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Règles partagées par toute l'équipe du contentieux.{' '}
            {canManage
              ? 'Tu peux les modifier (magistrat / admin).'
              : 'Seuls les magistrats du contentieux et les admins peuvent les modifier.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={isSubscribed}
              onChange={onToggleSubscription}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className={isSubscribed ? '' : 'text-gray-400'}>
              {isSubscribed ? 'Abonné' : 'Non abonné'}
            </span>
          </label>
          {canManage && (
            <Button size="sm" onClick={() => setShowNewRuleDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Nouvelle règle
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleRules.length === 0 && (
          <p className="text-sm text-gray-400 italic">Aucune règle configurée.</p>
        )}
        {visibleRules.map(rule => (
          <Card key={rule.id} className={`shadow-sm ${rule.isSystemRule ? 'border-green-200' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  {rule.name || getTypeLabel(rule.type)}
                  {rule.isSystemRule && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Système</span>
                  )}
                  {rule.recurrence?.enabled && (
                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded flex items-center gap-1">
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
                  onCheckedChange={() => canManage && handleToggleRule(rule)}
                  disabled={!canManage}
                />
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => duplicateRule(rule)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
                {canManage && editingRule?.id === rule.id ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={handleSaveEdit}>
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingRule(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : canManage ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditingRule(rule)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    {!rule.isSystemRule && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => deleteRule(rule.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </CardHeader>
            {canManage && editingRule?.id === rule.id && (
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">Délai d'alerte:</span>
                  <Input
                    type="number"
                    min="1"
                    value={editingRule.threshold}
                    onChange={(e) => setEditingRule({ ...editingRule, threshold: parseInt(e.target.value) })}
                    className="w-24"
                  />
                  <span className="text-sm text-gray-600">jours</span>
                </div>

                {editingRule.type === 'acte_expiration' && (
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">Type d'acte:</span>
                    <Select
                      value={editingRule.acteType || 'all'}
                      onChange={(e) => setEditingRule({ ...editingRule, acteType: e.target.value })}
                      className="w-40"
                    >
                      <option value="all">Tous les actes</option>
                      <option value="geolocalisation">Géolocalisation</option>
                      <option value="ecoute">Écoute</option>
                      <option value="autre">Autre acte</option>
                    </Select>
                  </div>
                )}

                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      id={`recurrence-${contentieuxId}-${rule.id}`}
                      checked={editingRule.recurrence?.enabled || false}
                      onChange={(e) => setEditingRule({
                        ...editingRule,
                        recurrence: {
                          ...(editingRule.recurrence || { defaultInterval: 7 }),
                          enabled: e.target.checked,
                        },
                      })}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor={`recurrence-${contentieuxId}-${rule.id}`} className="text-sm font-medium">
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
                              ...(editingRule.recurrence || {}),
                              defaultInterval: parseInt(e.target.value) || 7,
                            },
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
                            const value = e.target.value.trim() === '' ? undefined : parseInt(e.target.value);
                            setEditingRule({
                              ...editingRule,
                              recurrence: {
                                ...(editingRule.recurrence || {}),
                                maxOccurrences: value,
                              },
                            });
                          }}
                          className="w-24"
                        />
                        <span className="text-sm text-gray-600">fois (vide = illimité)</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </CardContent>

      {canManage && (
        <Dialog open={showNewRuleDialog} onOpenChange={setShowNewRuleDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouvelle règle — {contentieuxLabel}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Type d'alerte</label>
                <Select
                  value={newRule.type}
                  onChange={(e) => setNewRule(prev => ({ ...prev, type: e.target.value as AlertRule['type'] }))}
                >
                  <option value="cr_delay">Délai compte rendu</option>
                  <option value="acte_expiration">Expiration acte</option>
                  <option value="enquete_age">Âge enquête</option>
                  {userHasAIR && (
                    <>
                      <option value="air_6_mois">Mesure AIR &gt; 6 mois</option>
                      <option value="air_12_mois">Mesure AIR &gt; 12 mois</option>
                      <option value="air_rdv_delai">Délai depuis RDV AIR</option>
                    </>
                  )}
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Titre de l'alerte</label>
                <Input
                  value={newRule.name}
                  onChange={(e) => setNewRule(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Titre personnalisé (optionnel)"
                />
              </div>

              {newRule.type === 'acte_expiration' && (
                <div>
                  <label className="text-sm font-medium">Type d'acte</label>
                  <Select
                    value={newRule.acteType}
                    onChange={(e) => setNewRule(prev => ({ ...prev, acteType: e.target.value }))}
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
                  onChange={(e) => setNewRule(prev => ({ ...prev, threshold: parseInt(e.target.value) }))}
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id={`new-rule-recurrence-${contentieuxId}`}
                    checked={newRule.recurrence?.enabled || false}
                    onChange={(e) => setNewRule(prev => ({
                      ...prev,
                      recurrence: {
                        ...(prev.recurrence || { defaultInterval: 7 }),
                        enabled: e.target.checked,
                      },
                    }))}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor={`new-rule-recurrence-${contentieuxId}`} className="text-sm font-medium">
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
                            ...(prev.recurrence || {}),
                            defaultInterval: parseInt(e.target.value) || 7,
                          },
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
                          const value = e.target.value.trim() === '' ? undefined : parseInt(e.target.value);
                          setNewRule(prev => ({
                            ...prev,
                            recurrence: { ...(prev.recurrence || {}), maxOccurrences: value },
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
              <Button variant="outline" onClick={() => setShowNewRuleDialog(false)}>Annuler</Button>
              <Button onClick={handleCreateRule}>Créer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
};
