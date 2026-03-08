import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Enquete, AlertRule } from '@/types/interfaces';
import { Calendar, FileText, Clock } from 'lucide-react';

interface WeeklyRecapPopupProps {
  isOpen: boolean;
  onClose: () => void;
  enquetes: Enquete[];
  alertRules: AlertRule[];
}

export const WeeklyRecapPopup = ({ isOpen, onClose, enquetes, alertRules }: WeeklyRecapPopupProps) => {
  const today = new Date();

  // Règles actives
  const crRule = alertRules.find(r => r.type === 'cr_delay' && r.enabled);
  const acteRule = alertRules.find(r => r.type === 'acte_expiration' && r.enabled);

  const crThreshold = crRule?.threshold ?? 7;
  const acteThreshold = acteRule?.threshold ?? 7;

  // Actes / écoutes / géoloc arrivant à échéance
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

  // Enquêtes à relancer (pas de CR depuis crThreshold jours)
  const enquetesARelancer = enquetes
    .filter(e => e.statut === 'en_cours' && e.comptesRendus.length > 0)
    .map(e => {
      const lastCR = e.comptesRendus[0];
      const days = Math.floor((today.getTime() - new Date(lastCR.date).getTime()) / (1000 * 60 * 60 * 24));
      return { enquete: e, days };
    })
    .filter(({ days }) => days >= crThreshold)
    .sort((a, b) => b.days - a.days);

  const totalItems = actesEcheance.length + enquetesARelancer.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Récapitulatif — {today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </DialogTitle>
        </DialogHeader>

        {totalItems === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">Aucun élément à signaler cette semaine.</p>
        ) : (
          <div className="space-y-5 py-2">

            {/* Échéances d'actes à venir */}
            {actesEcheance.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-red-600 flex items-center gap-1 mb-2">
                  <Calendar className="h-3.5 w-3.5" />
                  Échéances d'actes à venir ({actesEcheance.length})
                </h4>
                <ul className="space-y-1.5">
                  {actesEcheance.map((a, i) => (
                    <li key={i} className={`rounded-lg px-3 py-2 text-sm ${a.daysLeft <= 2 ? 'bg-red-50' : 'bg-yellow-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{a.enqueteNumero}</span>
                        <span className="text-gray-600 flex-1">{a.category} — à prolonger</span>
                        <Badge
                          variant="outline"
                          className={a.daysLeft === 0
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : a.daysLeft <= 2
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : 'bg-yellow-100 text-yellow-700 border-yellow-300'}
                        >
                          {a.daysLeft === 0 ? "Expire aujourd'hui" : `${a.daysLeft}j`}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Enquêtes à relancer */}
            {enquetesARelancer.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-orange-600 flex items-center gap-1 mb-1">
                  <FileText className="h-3.5 w-3.5" />
                  Enquêtes à relancer ({enquetesARelancer.length})
                </h4>
                <p className="text-xs text-gray-500 mb-2">
                  Envoyer un mail d'actualisation aux directeurs d'enquêtes des enquêtes suivantes :
                </p>
                <ul className="space-y-1.5">
                  {enquetesARelancer.map(({ enquete: e, days }) => (
                    <li key={e.id} className="rounded-lg px-3 py-2 text-sm bg-orange-50">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{e.numero}</span>
                          {e.directeurEnquete && (
                            <span className="text-gray-500 ml-1">({e.directeurEnquete})</span>
                          )}
                          <span className="text-xs text-gray-500 block truncate">
                            {e.misEnCause.map(m => m.nom).join(', ')}
                          </span>
                        </div>
                        <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300 shrink-0">
                          {days}j sans CR
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
