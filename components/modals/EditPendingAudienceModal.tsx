import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useAudience } from '@/hooks/useAudience';
import { useToast } from '@/contexts/ToastContext';
import { Confiscations, emptyConfiscations, TypeVehicule, TypeImmeuble, CategorieObjet, TypeStupefiant } from '@/types/audienceTypes';

interface EditPendingAudienceModalProps {
  isOpen: boolean;
  onClose: () => void;
  enqueteId: number;
}

export const EditPendingAudienceModal = ({
  isOpen,
  onClose,
  enqueteId
}: EditPendingAudienceModalProps) => {
  const { audienceState, saveResultat } = useAudience();
  const { showToast } = useToast();
  
  const [audienceDate, setAudienceDate] = useState('');
  const [dateDefere, setDateDefere] = useState('');
  const [nombreDeferes, setNombreDeferes] = useState(0);
  const [saisies, setSaisies] = useState<Confiscations>(emptyConfiscations());

  useEffect(() => {
    const resultat = audienceState?.resultats?.[enqueteId];
    if (resultat) {
      setAudienceDate(resultat.dateAudience || '');
      setDateDefere(resultat.dateDefere || '');
      setNombreDeferes(resultat.nombreDeferes || 0);
      setSaisies(resultat.saisies || emptyConfiscations());
    }
  }, [enqueteId, audienceState]);

  const handleSave = async () => {
    try {
      const currentResultat = audienceState?.resultats?.[enqueteId];
      if (!currentResultat) return;

      const hasSaisies = saisies.vehicules.length > 0 || saisies.immeubles.length > 0 ||
        saisies.numeraire > 0 || saisies.saisiesBancaires.length > 0 ||
        saisies.cryptomonnaies.length > 0 || saisies.objetsMobiliers.length > 0 ||
        (saisies.stupefiants?.types?.length ?? 0) > 0;

      const updatedResultat = {
        ...currentResultat,
        dateAudience: audienceDate,
        dateDefere: dateDefere || undefined,
        nombreDeferes: nombreDeferes > 0 ? nombreDeferes : undefined,
        saisies: hasSaisies ? saisies : undefined
      };

      await saveResultat(updatedResultat);
      showToast('Informations mises à jour', 'success');
      onClose();
    } catch (error) {
      showToast('Erreur lors de la mise à jour', 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier l'audience en attente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Date d'audience</label>
            <Input
              type="date"
              value={audienceDate}
              onChange={(e) => setAudienceDate(e.target.value)}
              required
            />
          </div>
          
          <div className="border-t pt-4">
            <label className="text-sm font-medium mb-2 block">Défèrement (optionnel)</label>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-600">Date de défèrement</label>
                <Input
                  type="date"
                  value={dateDefere}
                  onChange={(e) => setDateDefere(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Nombre de personnes déférées</label>
                <Input
                  type="number"
                  min="0"
                  value={nombreDeferes}
                  onChange={(e) => setNombreDeferes(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Saisies */}
        <div className="border-t pt-4">
          <label className="text-sm font-medium mb-2 block">Saisies effectuées (optionnel)</label>
          <details className="mb-2 border rounded-lg">
            <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50 flex justify-between items-center">
              <span>Véhicules ({saisies.vehicules.length})</span>
              <Button type="button" variant="outline" size="sm" onClick={(e) => { e.preventDefault(); setSaisies(prev => ({ ...prev, vehicules: [...prev.vehicules, { type: 'voiture' as TypeVehicule }] })); }}>+</Button>
            </summary>
            <div className="p-2 space-y-1">
              {saisies.vehicules.map((v, i) => (
                <div key={i} className="flex gap-1 items-end text-sm">
                  <select className="p-1 border rounded text-sm flex-1" value={v.type} onChange={(e) => { const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], type: e.target.value as TypeVehicule }; setSaisies(prev => ({ ...prev, vehicules: arr })); }}>
                    <option value="voiture">Voiture</option><option value="moto">Moto</option><option value="scooter">Scooter</option><option value="utilitaire">Utilitaire</option><option value="poids_lourd">Poids lourd</option><option value="bateau">Bateau</option><option value="autre">Autre</option>
                  </select>
                  <Input className="text-sm flex-1" placeholder="Marque" value={v.marqueModele || ''} onChange={(e) => { const arr = [...saisies.vehicules]; arr[i] = { ...arr[i], marqueModele: e.target.value }; setSaisies(prev => ({ ...prev, vehicules: arr })); }} />
                  <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, vehicules: prev.vehicules.filter((_, j) => j !== i) }))}>×</Button>
                </div>
              ))}
            </div>
          </details>
          <details className="mb-2 border rounded-lg">
            <summary className="cursor-pointer p-2 text-sm font-medium bg-gray-50">Avoirs financiers</summary>
            <div className="p-2 space-y-2">
              <div><Label className="text-xs">Numéraire (€)</Label><Input type="number" min="0" className="text-sm" value={saisies.numeraire || ''} onChange={(e) => setSaisies(prev => ({ ...prev, numeraire: parseInt(e.target.value) || 0 }))} /></div>
              <div>
                <div className="flex justify-between items-center mb-1"><Label className="text-xs">Saisies bancaires</Label><Button type="button" variant="outline" size="sm" onClick={() => setSaisies(prev => ({ ...prev, saisiesBancaires: [...prev.saisiesBancaires, { montant: 0 }] }))}>+</Button></div>
                {saisies.saisiesBancaires.map((sb, i) => (
                  <div key={i} className="flex gap-1 items-end mb-1">
                    <Input className="text-sm flex-1" type="number" min="0" placeholder="Montant €" value={sb.montant || ''} onChange={(e) => { const arr = [...saisies.saisiesBancaires]; arr[i] = { ...arr[i], montant: parseInt(e.target.value) || 0 }; setSaisies(prev => ({ ...prev, saisiesBancaires: arr })); }} />
                    <Input className="text-sm flex-1" placeholder="Banque" value={sb.banque || ''} onChange={(e) => { const arr = [...saisies.saisiesBancaires]; arr[i] = { ...arr[i], banque: e.target.value }; setSaisies(prev => ({ ...prev, saisiesBancaires: arr })); }} />
                    <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, saisiesBancaires: prev.saisiesBancaires.filter((_, j) => j !== i) }))}>×</Button>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex justify-between items-center mb-1"><Label className="text-xs">Cryptomonnaies</Label><Button type="button" variant="outline" size="sm" onClick={() => setSaisies(prev => ({ ...prev, cryptomonnaies: [...prev.cryptomonnaies, { montantEur: 0 }] }))}>+</Button></div>
                {saisies.cryptomonnaies.map((cr, i) => (
                  <div key={i} className="flex gap-1 items-end mb-1">
                    <Input className="text-sm flex-1" type="number" min="0" placeholder="Valeur €" value={cr.montantEur || ''} onChange={(e) => { const arr = [...saisies.cryptomonnaies]; arr[i] = { ...arr[i], montantEur: parseInt(e.target.value) || 0 }; setSaisies(prev => ({ ...prev, cryptomonnaies: arr })); }} />
                    <Input className="text-sm flex-1" placeholder="Type" value={cr.typeCrypto || ''} onChange={(e) => { const arr = [...saisies.cryptomonnaies]; arr[i] = { ...arr[i], typeCrypto: e.target.value }; setSaisies(prev => ({ ...prev, cryptomonnaies: arr })); }} />
                    <Button type="button" variant="destructive" size="sm" onClick={() => setSaisies(prev => ({ ...prev, cryptomonnaies: prev.cryptomonnaies.filter((_, j) => j !== i) }))}>×</Button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={!audienceDate}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
