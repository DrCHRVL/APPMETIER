import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Enquete, AlertRule } from '@/types/interfaces';
import { Calendar, FileText, Clock, CheckSquare, Square } from 'lucide-react';

interface WeeklyRecapPopupProps {
  isOpen: boolean;
  onClose: () => void;
  enquetes: Enquete[];
  alertRules: AlertRule[];
}

interface TodoItem {
  id: string;
  action: string;
  detail: string;
  badge: string;
  urgency: 'high' | 'medium';
}

export const WeeklyRecapPopup = ({ isOpen, onClose, enquetes, alertRules }: WeeklyRecapPopupProps) => {
  const today = new Date();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggleCheck = (id: string) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Règles actives
  const crRule = alertRules.find(r => r.type === 'cr_delay' && r.enabled);
  const acteRule = alertRules.find(r => r.type === 'acte_expiration' && r.enabled);

  const crThreshold = crRule?.threshold ?? 7;
  const acteThreshold = acteRule?.threshold ?? 7;

  // Enquêtes à relancer (pas de CR depuis crThreshold jours)
  const enquetesARelancer = enquetes
    .filter(e => e.statut === 'en_cours' && e.comptesRendus.length > 0)
    .map(e => {
      const lastCR = e.comptesRendus[0];
      const days = Math.floor((today.getTime() - new Date(lastCR.date).getTime()) / (1000 * 60 * 60 * 24));
      return { enquete: e, days, lastCRDate: lastCR.date };
    })
    .filter(({ days }) => days >= crThreshold)
    .sort((a, b) => b.days - a.days);

  // Actes arrivant à échéance dans acteThreshold jours
  const actesEcheance = enquetes
    .filter(e => e.statut === 'en_cours')
    .flatMap(e => {
      const all = [
        ...(e.actes || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Acte' })),
        ...(e.ecoutes || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Écoute' })),
        ...(e.geolocalisations || []).map(a => ({ ...a, enqueteNumero: e.numero, category: 'Géoloc' })),
      ];
      return all;
    })
    .filter(a => a.statut === 'en_cours' && (a as any).dateFin)
    .map(a => {
      const daysLeft = Math.ceil((new Date((a as any).dateFin).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...a, daysLeft };
    })
    .filter(a => a.daysLeft >= 0 && a.daysLeft <= acteThreshold)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Construction de la todo list
  const actesTodos: TodoItem[] = actesEcheance.map((a, i) => ({
    id: `acte-${i}`,
    action: a.daysLeft === 0
      ? `Renouveler ou clôturer l'autorisation ${a.category.toLowerCase()} — enquête ${a.enqueteNumero}`
      : `Anticiper le renouvellement de l'autorisation ${a.category.toLowerCase()} — enquête ${a.enqueteNumero}`,
    detail: a.daysLeft === 0
      ? "L'autorisation expire aujourd'hui. Agir immédiatement."
      : `L'autorisation expire dans ${a.daysLeft} jour${a.daysLeft > 1 ? 's' : ''}. Préparer le renouvellement ou prévoir la clôture.`,
    badge: a.daysLeft === 0 ? "Urgent" : `${a.daysLeft}j restants`,
    urgency: a.daysLeft <= 2 ? 'high' : 'medium',
  }));

  const relancerTodos: TodoItem[] = enquetesARelancer.map(({ enquete: e, days }) => ({
    id: `cr-${e.id}`,
    action: `Rédiger un compte rendu pour l'enquête ${e.numero}`,
    detail: `Aucun CR depuis ${days} jour${days > 1 ? 's' : ''}. Contacter ou relancer ${e.misEnCause.map(m => m.nom).join(', ')}.`,
    badge: `${days}j sans CR`,
    urgency: 'medium',
  }));

  const allTodos = [...actesTodos, ...relancerTodos];
  const doneCount = allTodos.filter(t => checked[t.id]).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Todo — Semaine du {today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </DialogTitle>
          <p className="text-xs text-gray-500">
            {allTodos.length === 0
              ? 'Aucune action requise cette semaine.'
              : `${doneCount} / ${allTodos.length} tâche${allTodos.length > 1 ? 's' : ''} effectuée${doneCount > 1 ? 's' : ''}`}
          </p>
        </DialogHeader>

        {allTodos.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">Aucun élément à signaler cette semaine.</p>
        ) : (
          <div className="space-y-3 py-2">

            {/* Section actes */}
            {actesTodos.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-red-600 flex items-center gap-1 mb-2">
                  <Calendar className="h-3.5 w-3.5" />
                  Autorisations à traiter ({actesTodos.length})
                </h4>
                <ul className="space-y-2">
                  {actesTodos.map(todo => (
                    <li
                      key={todo.id}
                      onClick={() => toggleCheck(todo.id)}
                      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        checked[todo.id]
                          ? 'bg-gray-50 opacity-60'
                          : todo.urgency === 'high'
                          ? 'bg-red-50 hover:bg-red-100'
                          : 'bg-yellow-50 hover:bg-yellow-100'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 text-gray-400">
                        {checked[todo.id]
                          ? <CheckSquare className="h-4 w-4 text-green-500" />
                          : <Square className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug ${checked[todo.id] ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {todo.action}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{todo.detail}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-xs ${
                          todo.urgency === 'high'
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                        }`}
                      >
                        {todo.badge}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Section comptes rendus */}
            {relancerTodos.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-orange-600 flex items-center gap-1 mb-2">
                  <FileText className="h-3.5 w-3.5" />
                  Comptes rendus à rédiger ({relancerTodos.length})
                </h4>
                <ul className="space-y-2">
                  {relancerTodos.map(todo => (
                    <li
                      key={todo.id}
                      onClick={() => toggleCheck(todo.id)}
                      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        checked[todo.id]
                          ? 'bg-gray-50 opacity-60'
                          : 'bg-orange-50 hover:bg-orange-100'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 text-gray-400">
                        {checked[todo.id]
                          ? <CheckSquare className="h-4 w-4 text-green-500" />
                          : <Square className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug ${checked[todo.id] ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {todo.action}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{todo.detail}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs bg-orange-100 text-orange-700 border-orange-300">
                        {todo.badge}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2">
          {allTodos.length > 0 && (
            <span className="text-xs text-gray-400">
              Coche chaque tâche au fur et à mesure
            </span>
          )}
          <Button onClick={onClose} className="ml-auto">Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
