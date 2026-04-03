import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { AlertRule, WeeklyPopupConfig, VisualAlertRule, VisualAlertTrigger, VisualAlertMode, VisualAlertColorKey } from '@/types/interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select } from '../ui/select';
import { Edit2, Save, X, Plus, Copy, Clock, RefreshCw, Eye, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { AlertValidation } from '@/utils/alerts/alertValidation';
import { ElectronBridge } from '@/utils/electronBridge';
import { VISUAL_ALERT_COLOR_PALETTE, VISUAL_ALERT_COLOR_KEYS, VISUAL_ALERT_TRIGGER_LABELS } from '@/config/constants';
import { useUser } from '@/contexts/UserContext';

const WEEKLY_POPUP_KEY = 'weekly_popup_config';
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Composant pastille de couleur cliquable
const ColorDot = ({ colorKey, selected, onClick }: { colorKey: VisualAlertColorKey; selected: boolean; onClick: () => void }) => {
  const color = VISUAL_ALERT_COLOR_PALETTE[colorKey];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 rounded-full ${color.dot} transition-all ${selected ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : 'hover:scale-110'}`}
      title={color.label}
    />
  );
};

// Aperçu visuel d'une règle
const VisualRulePreview = ({ rule }: { rule: VisualAlertRule }) => {
  const fondColor = VISUAL_ALERT_COLOR_PALETTE[rule.fondColor];
  const bordureColor = VISUAL_ALERT_COLOR_PALETTE[rule.bordureColor];
  const showFond = rule.mode === 'fond' || rule.mode === 'fond_bordure';
  const showBordure = rule.mode === 'bordure' || rule.mode === 'fond_bordure';

  return (
    <div
      className={`w-24 h-8 rounded border ${showFond ? fondColor.fond : 'bg-white'} ${showBordure ? `border-l-4 ${bordureColor.bordureLeft} border-t border-t-gray-200 border-r border-r-gray-200 border-b border-b-gray-200` : 'border-gray-200'} flex items-center justify-center`}
    >
      <span className="text-[9px] text-gray-500">Aperçu</span>
    </div>
  );
};

// ====== Composant section alertes visuelles ======
const VisualAlertsSection = ({
  rules,
  onUpdateRule,
  onDeleteRule,
  onReorderRules,
}: {
  rules: VisualAlertRule[];
  onUpdateRule: (rule: VisualAlertRule) => void;
  onDeleteRule?: (ruleId: number) => void;
  onReorderRules?: (rules: VisualAlertRule[]) => void;
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<VisualAlertRule | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newRule, setNewRule] = useState<Partial<VisualAlertRule>>({
    trigger: 'acte_critique',
    label: '',
    seuil: 7,
    mode: 'fond_bordure',
    fondColor: 'orange',
    bordureColor: 'orange',
    enabled: true,
  });

  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  const startEdit = (rule: VisualAlertRule) => {
    setEditingId(rule.id);
    setEditDraft({ ...rule });
  };

  const saveEdit = () => {
    if (editDraft) {
      onUpdateRule(editDraft);
      setEditingId(null);
      setEditDraft(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const moveRule = (ruleId: number, direction: 'up' | 'down') => {
    const idx = sortedRules.findIndex(r => r.id === ruleId);
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === sortedRules.length - 1)) return;
    const newRules = [...sortedRules];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newRules[idx], newRules[swapIdx]] = [newRules[swapIdx], newRules[idx]];
    onReorderRules?.(newRules);
  };

  const handleCreateRule = () => {
    if (!newRule.trigger || !newRule.seuil) return;
    const maxPriority = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0;
    const rule: VisualAlertRule = {
      id: Date.now(),
      trigger: newRule.trigger as VisualAlertTrigger,
      label: newRule.label || VISUAL_ALERT_TRIGGER_LABELS[newRule.trigger] || '',
      seuil: newRule.seuil,
      mode: newRule.mode as VisualAlertMode || 'fond_bordure',
      fondColor: newRule.fondColor as VisualAlertColorKey || 'orange',
      bordureColor: newRule.bordureColor as VisualAlertColorKey || 'orange',
      enabled: true,
      priority: maxPriority + 1,
    };
    onUpdateRule(rule);
    setShowNewDialog(false);
    setNewRule({ trigger: 'acte_critique', label: '', seuil: 7, mode: 'fond_bordure', fondColor: 'orange', bordureColor: 'orange', enabled: true });
  };

  const seuilLabel = (trigger: string) => {
    switch (trigger) {
      case 'op_active': return null; // pas de seuil, c'est "date dépassée"
      case 'op_proche': return 'OP dans';
      case 'acte_critique': return 'Expire dans';
      case 'cr_retard': return 'Retard de';
      case 'prolongation_pending': return 'En attente depuis';
      case 'autorisation_pending': return 'En attente depuis';
      case 'jld_pending': return 'En attente depuis';
      default: return 'Seuil';
    }
  };

  return (
    <Card className="mb-6 border-purple-200 bg-purple-50/30">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5 text-purple-600" />
            Alertes visuelles
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Couleur et bordure sur les cartes enquêtes. Le fond ne peut afficher qu'une couleur (priorité haute gagne). Les bordures se cumulent (gauche + droite).
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Ajouter
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {sortedRules.map((rule, idx) => (
          <div key={rule.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${rule.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
            {/* Flèches priorité */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveRule(rule.id, 'up')}
                disabled={idx === 0}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-20"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => moveRule(rule.id, 'down')}
                disabled={idx === sortedRules.length - 1}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-20"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Numéro priorité */}
            <span className="text-xs text-gray-400 w-4 text-center font-mono">{idx + 1}</span>

            {/* Aperçu */}
            <VisualRulePreview rule={editingId === rule.id && editDraft ? editDraft : rule} />

            {/* Contenu */}
            {editingId === rule.id && editDraft ? (
              /* MODE ÉDITION */
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    value={editDraft.label}
                    onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                    className="h-7 text-sm w-48"
                    placeholder="Nom de la règle"
                  />
                  <Select
                    value={editDraft.trigger}
                    onChange={(e) => setEditDraft({ ...editDraft, trigger: e.target.value as VisualAlertTrigger })}
                    className="h-7 text-sm w-48"
                  >
                    {Object.entries(VISUAL_ALERT_TRIGGER_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </Select>
                  {seuilLabel(editDraft.trigger) && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">{seuilLabel(editDraft.trigger)}</span>
                      <Input
                        type="number"
                        min="0"
                        value={editDraft.seuil}
                        onChange={(e) => setEditDraft({ ...editDraft, seuil: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="h-7 text-sm w-16"
                      />
                      <span className="text-xs text-gray-500">jours</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={editDraft.mode}
                    onChange={(e) => setEditDraft({ ...editDraft, mode: e.target.value as VisualAlertMode })}
                    className="h-7 text-sm w-40"
                  >
                    <option value="fond">Fond uniquement</option>
                    <option value="bordure">Bordure uniquement</option>
                    <option value="fond_bordure">Fond + Bordure</option>
                  </Select>

                  {(editDraft.mode === 'fond' || editDraft.mode === 'fond_bordure') && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">Fond:</span>
                      <div className="flex gap-1">
                        {VISUAL_ALERT_COLOR_KEYS.map(ck => (
                          <ColorDot key={ck} colorKey={ck} selected={editDraft.fondColor === ck} onClick={() => setEditDraft({ ...editDraft, fondColor: ck })} />
                        ))}
                      </div>
                    </div>
                  )}

                  {(editDraft.mode === 'bordure' || editDraft.mode === 'fond_bordure') && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">Bordure:</span>
                      <div className="flex gap-1">
                        {VISUAL_ALERT_COLOR_KEYS.map(ck => (
                          <ColorDot key={ck} colorKey={ck} selected={editDraft.bordureColor === ck} onClick={() => setEditDraft({ ...editDraft, bordureColor: ck })} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* MODE LECTURE */
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{rule.label}</span>
                  {rule.isSystemRule && (
                    <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded">Système</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {VISUAL_ALERT_TRIGGER_LABELS[rule.trigger] || rule.trigger}
                  {seuilLabel(rule.trigger) ? ` — ${seuilLabel(rule.trigger)} ${rule.seuil}j` : ''}
                  {' — '}
                  {rule.mode === 'fond' ? 'Fond' : rule.mode === 'bordure' ? 'Bordure' : 'Fond + Bordure'}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Switch
                checked={rule.enabled}
                onCheckedChange={() => onUpdateRule({ ...rule, enabled: !rule.enabled })}
              />
              {editingId === rule.id ? (
                <>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={saveEdit}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={cancelEdit}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(rule)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  {!rule.isSystemRule && onDeleteRule && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => onDeleteRule(rule.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {sortedRules.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">Aucune règle visuelle configurée.</p>
        )}
      </CardContent>

      {/* Dialog nouvelle règle visuelle */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle alerte visuelle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Déclencheur</label>
              <Select
                value={newRule.trigger}
                onChange={(e) => setNewRule(prev => ({ ...prev, trigger: e.target.value as VisualAlertTrigger }))}
              >
                {Object.entries(VISUAL_ALERT_TRIGGER_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Nom (optionnel)</label>
              <Input
                value={newRule.label || ''}
                onChange={(e) => setNewRule(prev => ({ ...prev, label: e.target.value }))}
                placeholder={VISUAL_ALERT_TRIGGER_LABELS[newRule.trigger || 'acte_critique']}
              />
            </div>

            {newRule.trigger !== 'op_active' && (
              <div>
                <label className="text-sm font-medium">Seuil (jours)</label>
                <Input
                  type="number"
                  min="0"
                  value={newRule.seuil}
                  onChange={(e) => setNewRule(prev => ({ ...prev, seuil: Math.max(0, parseInt(e.target.value) || 0) }))}
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Mode d'affichage</label>
              <Select
                value={newRule.mode}
                onChange={(e) => setNewRule(prev => ({ ...prev, mode: e.target.value as VisualAlertMode }))}
              >
                <option value="fond">Fond uniquement</option>
                <option value="bordure">Bordure uniquement</option>
                <option value="fond_bordure">Fond + Bordure</option>
              </Select>
            </div>

            {(newRule.mode === 'fond' || newRule.mode === 'fond_bordure') && (
              <div>
                <label className="text-sm font-medium mb-2 block">Couleur du fond</label>
                <div className="flex gap-2">
                  {VISUAL_ALERT_COLOR_KEYS.map(ck => (
                    <ColorDot key={ck} colorKey={ck} selected={newRule.fondColor === ck} onClick={() => setNewRule(prev => ({ ...prev, fondColor: ck }))} />
                  ))}
                </div>
              </div>
            )}

            {(newRule.mode === 'bordure' || newRule.mode === 'fond_bordure') && (
              <div>
                <label className="text-sm font-medium mb-2 block">Couleur de la bordure</label>
                <div className="flex gap-2">
                  {VISUAL_ALERT_COLOR_KEYS.map(ck => (
                    <ColorDot key={ck} colorKey={ck} selected={newRule.bordureColor === ck} onClick={() => setNewRule(prev => ({ ...prev, bordureColor: ck }))} />
                  ))}
                </div>
              </div>
            )}

            {/* Aperçu */}
            <div className="border-t pt-3">
              <label className="text-sm font-medium mb-2 block">Aperçu</label>
              <VisualRulePreview rule={newRule as VisualAlertRule} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Annuler</Button>
            <Button onClick={handleCreateRule}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

interface AlertsPageProps {
  rules: AlertRule[];
  onUpdateRule: (rule: AlertRule) => void;
  onDuplicateRule: (rule: AlertRule) => void;
  onDeleteRule: (ruleId: number) => void;
  onShowWeeklyPopup?: () => void;
  // Props pour les alertes visuelles
  visualAlertRules?: VisualAlertRule[];
  onUpdateVisualAlertRule?: (rule: VisualAlertRule) => void;
  onDeleteVisualAlertRule?: (ruleId: number) => void;
  onReorderVisualAlertRules?: (rules: VisualAlertRule[]) => void;
}

export const AlertsPage = ({ rules, onUpdateRule, onDuplicateRule, onDeleteRule, onShowWeeklyPopup, visualAlertRules = [], onUpdateVisualAlertRule, onDeleteVisualAlertRule, onReorderVisualAlertRules }: AlertsPageProps) => {
  const { hasModule } = useUser();
  const userHasAIR = hasModule('air');

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
          <div className="flex items-center gap-3">
            {onShowWeeklyPopup && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={onShowWeeklyPopup}
                title="Afficher le récapitulatif maintenant"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Afficher maintenant
              </Button>
            )}
            <Switch
              checked={weeklyConfig.enabled}
              onCheckedChange={(v) => saveWeeklyConfig({ ...weeklyConfig, enabled: v })}
            />
          </div>
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
                <option value={7}>Chaque jour</option>
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
              S'affiche si l'app est ouverte après {weeklyConfig.hour}h00 {weeklyConfig.dayOfWeek === 7 ? 'chaque jour' : `le ${DAYS[weeklyConfig.dayOfWeek]}`}.
              Les seuils utilisés sont ceux des règles "Délai compte rendu" et "Expiration acte".
            </p>
          </CardContent>
        )}
      </Card>

      {/* ====== SECTION ALERTES VISUELLES ====== */}
      {onUpdateVisualAlertRule && (
        <VisualAlertsSection
          rules={visualAlertRules}
          onUpdateRule={onUpdateVisualAlertRule}
          onDeleteRule={onDeleteVisualAlertRule}
          onReorderRules={onReorderVisualAlertRules}
        />
      )}

      {/* ====== SECTION RÈGLES D'ALERTE CLASSIQUES ====== */}
      <div className="space-y-4">
        {rules.filter(rule => {
          // Masquer les règles AIR si le module n'est pas activé pour l'utilisateur
          if (!userHasAIR && ['air_6_mois', 'air_12_mois', 'air_rdv_delai'].includes(rule.type)) return false;
          return true;
        }).map(rule => (
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