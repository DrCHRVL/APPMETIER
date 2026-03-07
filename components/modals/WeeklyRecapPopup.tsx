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

  const totalItems = enquetesARelancer.length + actesEcheance.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Récapitulatif de la semaine
          </DialogTitle>
          <p className="text-xs text-gray-500">{today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </DialogHeader>

        {totalItems === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">Aucun élément à signaler cette semaine.</p>
        ) : (
          <div className="space-y-4 py-2">

            {/* Actes à surveiller */}
            {actesEcheance.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-1 mb-2">
                  <Calendar className="h-4 w-4 text-red-500" />
                  Actes arrivant à échéance ({actesEcheance.length})
                </h4>
                <div className="space-y-1">
                  {actesEcheance.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-red-50 rounded px-3 py-1.5 text-sm">
                      <span className="font-medium">{a.enqueteNumero}</span>
                      <span className="text-gray-600">{a.category}</span>
                      <Badge
                        variant="outline"
                        className={a.daysLeft <= 2 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-yellow-50 text-yellow-700 border-yellow-300'}
                      >
                        {a.daysLeft === 0 ? "Expire aujourd'hui" : `${a.daysLeft}j`}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Enquêtes à relancer */}
            {enquetesARelancer.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-1 mb-2">
                  <FileText className="h-4 w-4 text-orange-500" />
                  Enquêtes à relancer ({enquetesARelancer.length})
                </h4>
                <div className="space-y-1">
                  {enquetesARelancer.map(({ enquete: e, days }) => (
                    <div key={e.id} className="flex items-center justify-between bg-orange-50 rounded px-3 py-1.5 text-sm">
                      <span className="font-medium">{e.numero}</span>
                      <span className="text-xs text-gray-500 truncate max-w-[180px]">
                        {e.misEnCause.map(m => m.nom).join(', ')}
                      </span>
                      <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                        {days}j sans CR
                      </Badge>
                    </div>
                  ))}
                </div>
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
