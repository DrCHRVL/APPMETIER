import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { WeeklyPopupConfig, VisualAlertRule, VisualAlertTrigger, VisualAlertMode, VisualAlertColorKey } from '@/types/interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select } from '../ui/select';
import { Edit2, Save, X, Plus, Copy, Clock, RefreshCw, Eye, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { ElectronBridge } from '@/utils/electronBridge';
import { VISUAL_ALERT_COLOR_PALETTE, VISUAL_ALERT_COLOR_KEYS, VISUAL_ALERT_TRIGGER_LABELS } from '@/config/constants';
import { useUser } from '@/contexts/UserContext';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { ContentieuxAlertsBubble } from '@/components/ContentieuxAlertsBubble';

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
            Alertes visuelles personnelles
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Couleur et bordure sur les cartes enquêtes. Propres à chaque utilisateur : tes règles n'affectent que ton affichage. Le fond ne peut avoir qu'une couleur (priorité haute gagne) ; les bordures se cumulent.
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
  onShowWeeklyPopup?: () => void;
  // Props pour les alertes visuelles personnelles
  visualAlertRules?: VisualAlertRule[];
  onUpdateVisualAlertRule?: (rule: VisualAlertRule) => void;
  onDeleteVisualAlertRule?: (ruleId: number) => void;
  onReorderVisualAlertRules?: (rules: VisualAlertRule[]) => void;
}

export const AlertsPage = ({ onShowWeeklyPopup, visualAlertRules = [], onUpdateVisualAlertRule, onDeleteVisualAlertRule, onReorderVisualAlertRules }: AlertsPageProps) => {
  const { hasModule, accessibleContentieux, canDo } = useUser();
  const userHasAIR = hasModule('air');
  const {
    subscribedContentieux,
    setWeeklyRecapSubscriptions,
    subscribedContentieuxAlerts,
    setContentieuxAlertsSubscriptions,
    crDelayHighlight,
    setCrDelayHighlight,
  } = useUserPreferences();

  const toggleContentieuxSubscription = (id: string) => {
    const next = subscribedContentieux.includes(id)
      ? subscribedContentieux.filter(c => c !== id)
      : [...subscribedContentieux, id];
    setWeeklyRecapSubscriptions(next);
  };

  // Champ absent dans la prefs = auto-abonné à tous les contentieux accessibles.
  const effectiveAlertsSubscriptions = useMemo<string[]>(() => {
    if (Array.isArray(subscribedContentieuxAlerts)) return subscribedContentieuxAlerts;
    return accessibleContentieux.map(c => c.id);
  }, [subscribedContentieuxAlerts, accessibleContentieux]);

  const toggleAlertsSubscription = (id: string) => {
    const current = effectiveAlertsSubscriptions;
    const next = current.includes(id)
      ? current.filter(c => c !== id)
      : [...current, id];
    setContentieuxAlertsSubscriptions(next);
  };

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


  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Gestion des Alertes</h2>
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

            {/* Abonnement par contentieux : seuls les contentieux accessibles à
                l'utilisateur sont listés. Si aucun n'est coché, le popup ne
                s'ouvre pas. */}
            <div className="w-full border-t border-blue-100 pt-3 mt-1">
              <p className="text-sm font-medium text-gray-700 mb-2">Contentieux suivis</p>
              {accessibleContentieux.length === 0 ? (
                <p className="text-xs text-gray-400">Aucun contentieux accessible.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {accessibleContentieux.map(c => {
                    const checked = subscribedContentieux.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'bg-blue-100 border-blue-300'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleContentieuxSubscription(c.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span className="text-sm">{c.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {subscribedContentieux.length === 0 && accessibleContentieux.length > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  Aucun contentieux coché : le récapitulatif ne s'affichera pas.
                </p>
              )}
            </div>
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

      {/* Toggle simple : surlignage ambre de la ligne « Dernier CR » sur la
          carte enquête quand l'alerte cr_delay est active. Préférence perso. */}
      <Card className="mb-6 border-purple-200 bg-purple-50/30">
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Surligner « Dernier CR » en ambre quand l'alerte délai est active</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Met en évidence la ligne « Dernier CR » sur la carte enquête dès que le seuil de la règle « Délai compte rendu » est dépassé. Préférence personnelle.
              </p>
            </div>
            <Switch
              checked={crDelayHighlight}
              onCheckedChange={(v) => setCrDelayHighlight(v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ====== ALERTES PAR CONTENTIEUX (partagées) ====== */}
      {accessibleContentieux.length === 0 && (
        <Card className="mb-6 border-gray-200">
          <CardContent className="py-6 text-sm text-gray-500">
            Aucun contentieux accessible : rien à configurer ici.
          </CardContent>
        </Card>
      )}
      {accessibleContentieux.map(c => {
        const canManage = canDo(c.id, 'manage_alerts');
        const isSubscribed = effectiveAlertsSubscriptions.includes(c.id);
        return (
          <ContentieuxAlertsBubble
            key={c.id}
            contentieuxId={c.id}
            contentieuxLabel={c.label}
            contentieuxColor={c.color}
            canManage={canManage}
            isSubscribed={isSubscribed}
            onToggleSubscription={() => toggleAlertsSubscription(c.id)}
            userHasAIR={userHasAIR}
          />
        );
      })}
    </div>
  );
};