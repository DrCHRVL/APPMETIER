import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import {
  Plus,
  X,
  Edit3,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import {
  EnqueteInstruction,
  ActeInstruction,
  RequisoireSupletif,
  TypeActeInstruction,
  LIBELLES_ACTE_INSTRUCTION,
} from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface ActesInstructionSectionProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
}

const TYPE_OPTIONS: { value: TypeActeInstruction; label: string }[] = [
  { value: 'commission_rogatoire', label: 'Commission rogatoire' },
  { value: 'expertise', label: 'Expertise' },
  { value: 'audition_temoin', label: 'Audition de témoin' },
  { value: 'garde_a_vue', label: 'Garde à vue' },
  { value: 'ipc', label: 'IPC' },
  { value: 'interrogatoire_fond', label: 'Interrogatoire au fond' },
  { value: 'audition_partie_civile', label: 'Audition partie civile' },
];

const TYPE_EXPERTISE_OPTIONS = [
  { value: 'balistique', label: 'Balistique' },
  { value: 'technique', label: 'Technique' },
  { value: 'psychiatrique', label: 'Psychiatrique' },
  { value: 'psychologique', label: 'Psychologique' },
  { value: 'autre', label: 'Autre' },
];

const TYPE_COLORS: Record<TypeActeInstruction, string> = {
  commission_rogatoire: 'bg-blue-100 text-blue-800',
  expertise: 'bg-purple-100 text-purple-800',
  audition_temoin: 'bg-gray-100 text-gray-800',
  garde_a_vue: 'bg-orange-100 text-orange-800',
  ipc: 'bg-red-100 text-red-800',
  interrogatoire_fond: 'bg-red-100 text-red-800',
  audition_partie_civile: 'bg-green-100 text-green-800',
};

export const ActesInstructionSection = ({
  instruction,
  onUpdate,
}: ActesInstructionSectionProps) => {
  const { showToast } = useToast();
  const actes = instruction.actesInstruction || [];
  const requisoires = instruction.requisoiresSupletifs || [];

  // --- Formulaire ajout acte ---
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    type: 'audition_temoin' as TypeActeInstruction,
    date: new Date().toISOString().split('T')[0],
    libelle: '',
    retourPartiel: '',
    retourFinal: '',
    typeExpertise: 'autre' as ActeInstruction['typeExpertise'],
  });

  // --- Formulaire réquisitoire supplétif ---
  const [showReqForm, setShowReqForm] = useState(false);
  const [reqForm, setReqForm] = useState({ date: new Date().toISOString().split('T')[0], qualification: '' });

  // --- Collapse sections ---
  const [showReqs, setShowReqs] = useState(true);

  // Progression
  const totalActes = actes.length;
  const doneActes = actes.filter(a => a.done).length;
  const progression = totalActes === 0 ? 0 : Math.round((doneActes / totalActes) * 100);

  const progressColor =
    progression >= 75 ? 'bg-green-500' :
    progression >= 40 ? 'bg-yellow-500' :
    'bg-red-400';

  // --- Toggle DONE ---
  const handleToggleDone = (id: number) => {
    const updated = actes.map(a => a.id === id ? { ...a, done: !a.done } : a);
    onUpdate(instruction.id, { actesInstruction: updated });
  };

  // --- Ajout acte ---
  const handleAddActe = () => {
    if (!formData.libelle.trim()) {
      showToast('Libellé requis', 'error');
      return;
    }
    const newActe: ActeInstruction = {
      id: Date.now(),
      type: formData.type,
      date: formData.date,
      libelle: formData.libelle.trim(),
      done: false,
      ...(formData.type === 'commission_rogatoire' && {
        retourPartiel: formData.retourPartiel || undefined,
        retourFinal: formData.retourFinal || undefined,
      }),
      ...(formData.type === 'expertise' && {
        typeExpertise: formData.typeExpertise,
      }),
    };
    onUpdate(instruction.id, { actesInstruction: [...actes, newActe] });
    setFormData({ type: 'audition_temoin', date: new Date().toISOString().split('T')[0], libelle: '', retourPartiel: '', retourFinal: '', typeExpertise: 'autre' });
    setShowAddForm(false);
    showToast('Acte ajouté', 'success');
  };

  // --- Suppression acte ---
  const handleDeleteActe = (id: number) => {
    onUpdate(instruction.id, { actesInstruction: actes.filter(a => a.id !== id) });
  };

  // --- Mise à jour dates CR ---
  const handleUpdateCR = (id: number, field: 'retourPartiel' | 'retourFinal', value: string) => {
    const updated = actes.map(a => a.id === id ? { ...a, [field]: value || undefined } : a);
    onUpdate(instruction.id, { actesInstruction: updated });
  };

  // --- Réquisitoire supplétif ---
  const handleAddReq = () => {
    if (!reqForm.qualification.trim()) {
      showToast('Qualification requise', 'error');
      return;
    }
    const newReq: RequisoireSupletif = {
      id: Date.now(),
      date: reqForm.date,
      qualification: reqForm.qualification.trim(),
    };
    onUpdate(instruction.id, { requisoiresSupletifs: [...requisoires, newReq] });
    setReqForm({ date: new Date().toISOString().split('T')[0], qualification: '' });
    setShowReqForm(false);
    showToast('Réquisitoire supplétif ajouté', 'success');
  };

  const handleDeleteReq = (id: number) => {
    onUpdate(instruction.id, { requisoiresSupletifs: requisoires.filter(r => r.id !== id) });
  };

  // Trier les actes : non-done d'abord, puis par date
  const sortedActes = [...actes].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return (
    <div className="space-y-4">

      {/* Barre de progression */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Avancement du règlement
            </span>
            <span className={`text-sm font-bold ${
              progression >= 75 ? 'text-green-700' :
              progression >= 40 ? 'text-yellow-700' :
              'text-red-600'
            }`}>
              {doneActes} / {totalActes} actes réglés ({progression}%)
            </span>
          </div>
          <div className="h-2.5 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${progressColor}`}
              style={{ width: `${progression}%` }}
            />
          </div>
          {totalActes === 0 && (
            <p className="text-xs text-gray-400 mt-1 italic">Aucun acte enregistré</p>
          )}
        </CardContent>
      </Card>

      {/* Liste des actes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>Actes d'instruction ({totalActes})</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-green-700 hover:bg-green-50"
              onClick={() => { setShowAddForm(!showAddForm); setEditingId(null); }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Ajouter
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">

          {/* Formulaire d'ajout */}
          {showAddForm && (
            <div className="border rounded-lg p-3 bg-green-50 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600">Type *</label>
                  <Select
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value as TypeActeInstruction })}
                    className="h-8 text-xs"
                  >
                    {TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Date *</label>
                  <Input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Libellé *</label>
                <Input
                  value={formData.libelle}
                  onChange={e => setFormData({ ...formData, libelle: e.target.value })}
                  placeholder={
                    formData.type === 'commission_rogatoire' ? 'Ex: CR OCRTIS - réseau Dupont' :
                    formData.type === 'expertise' ? 'Ex: Expert Durand - arme n°12' :
                    formData.type === 'garde_a_vue' ? 'Ex: Dupont Jean - Brig. Crim.' :
                    'Description...'
                  }
                  className="h-8 text-xs"
                  autoFocus
                />
              </div>

              {/* Champs spécifiques expertise */}
              {formData.type === 'expertise' && (
                <div>
                  <label className="text-xs text-gray-600">Type d'expertise</label>
                  <Select
                    value={formData.typeExpertise}
                    onChange={e => setFormData({ ...formData, typeExpertise: e.target.value as ActeInstruction['typeExpertise'] })}
                    className="h-8 text-xs"
                  >
                    {TYPE_EXPERTISE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )}

              {/* Champs spécifiques CR */}
              {formData.type === 'commission_rogatoire' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600">Retour partiel</label>
                    <Input
                      type="date"
                      value={formData.retourPartiel}
                      onChange={e => setFormData({ ...formData, retourPartiel: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Retour final</label>
                    <Input
                      type="date"
                      value={formData.retourFinal}
                      onChange={e => setFormData({ ...formData, retourFinal: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddActe} className="text-xs h-7">
                  Ajouter
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="text-xs h-7">
                  Annuler
                </Button>
              </div>
            </div>
          )}

          {/* Liste */}
          {sortedActes.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-4">
              Aucun acte — cliquez sur Ajouter
            </p>
          ) : (
            <div className="space-y-1">
              {sortedActes.map(acte => (
                <div
                  key={acte.id}
                  className={`flex items-start gap-2 p-2 rounded border transition-colors ${
                    acte.done
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Checkbox DONE */}
                  <button
                    onClick={() => handleToggleDone(acte.id)}
                    className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-green-600 transition-colors"
                    title={acte.done ? 'Marquer comme non réglé' : 'Marquer comme réglé'}
                  >
                    {acte.done
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <Circle className="h-4 w-4" />
                    }
                  </button>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-xs px-1.5 py-0 ${TYPE_COLORS[acte.type]}`}>
                        {LIBELLES_ACTE_INSTRUCTION[acte.type]}
                        {acte.type === 'expertise' && acte.typeExpertise && ` · ${acte.typeExpertise}`}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {new Date(acte.date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className={`text-sm mt-0.5 ${acte.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {acte.libelle}
                    </p>

                    {/* Infos CR */}
                    {acte.type === 'commission_rogatoire' && (
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>
                          Retour partiel:{' '}
                          {editingId === acte.id ? (
                            <input
                              type="date"
                              defaultValue={acte.retourPartiel || ''}
                              onBlur={e => handleUpdateCR(acte.id, 'retourPartiel', e.target.value)}
                              className="border rounded px-1 text-xs"
                            />
                          ) : (
                            <span
                              className="cursor-pointer underline decoration-dotted"
                              onClick={() => setEditingId(acte.id)}
                            >
                              {acte.retourPartiel ? new Date(acte.retourPartiel).toLocaleDateString() : '—'}
                            </span>
                          )}
                        </span>
                        <span>
                          Retour final:{' '}
                          {editingId === acte.id ? (
                            <input
                              type="date"
                              defaultValue={acte.retourFinal || ''}
                              onBlur={e => { handleUpdateCR(acte.id, 'retourFinal', e.target.value); setEditingId(null); }}
                              className="border rounded px-1 text-xs"
                            />
                          ) : (
                            <span
                              className="cursor-pointer underline decoration-dotted"
                              onClick={() => setEditingId(acte.id)}
                            >
                              {acte.retourFinal ? new Date(acte.retourFinal).toLocaleDateString() : '—'}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Suppression */}
                  <button
                    onClick={() => handleDeleteActe(acte.id)}
                    className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors mt-0.5"
                    title="Supprimer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Réquisitoires supplétifs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-sm font-medium"
              onClick={() => setShowReqs(!showReqs)}
            >
              <FileText className="h-4 w-4 text-gray-500" />
              Réquisitoires supplétifs ({requisoires.length})
              {showReqs ? <ChevronUp className="h-3 w-3 ml-1 text-gray-400" /> : <ChevronDown className="h-3 w-3 ml-1 text-gray-400" />}
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-green-700 hover:bg-green-50"
              onClick={() => setShowReqForm(!showReqForm)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Ajouter
            </Button>
          </CardTitle>
        </CardHeader>

        {showReqs && (
          <CardContent className="space-y-2">
            {/* Formulaire */}
            {showReqForm && (
              <div className="border rounded-lg p-3 bg-blue-50 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600">Date *</label>
                    <Input
                      type="date"
                      value={reqForm.date}
                      onChange={e => setReqForm({ ...reqForm, date: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Qualification *</label>
                    <Input
                      value={reqForm.qualification}
                      onChange={e => setReqForm({ ...reqForm, qualification: e.target.value })}
                      placeholder="Ex: Association de malfaiteurs..."
                      className="h-8 text-xs"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddReq} className="text-xs h-7">
                    Ajouter
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowReqForm(false)} className="text-xs h-7">
                    Annuler
                  </Button>
                </div>
              </div>
            )}

            {/* Liste */}
            {requisoires.length === 0 && !showReqForm ? (
              <p className="text-xs text-gray-400 italic text-center py-2">Aucun réquisitoire supplétif</p>
            ) : (
              <div className="space-y-1">
                {[...requisoires]
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map(req => (
                    <div key={req.id} className="flex items-center justify-between p-2 bg-white border border-gray-200 rounded text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-medium">{new Date(req.date).toLocaleDateString()}</span>
                        <span className="text-gray-800">{req.qualification}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteReq(req.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors ml-2"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
};
