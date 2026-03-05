import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useState } from 'react';
import { Label } from '../ui/label';
import { Alert } from '@/types/interfaces';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';


interface ProlongationModalProps {
 isOpen: boolean;
 onClose: () => void;
 onConfirm: () => void;
 originalStartDate?: string;
 originalDuration?: string;
}

export const ProlongationModal = ({
 isOpen,
 onClose,
 onConfirm,
 originalStartDate,
 originalDuration
}: ProlongationModalProps) => {
 const { showToast } = useToast();
 
 const calculatedEndDate = originalStartDate && originalDuration ? 
   DateUtils.calculateActeEndDate(originalStartDate, originalDuration) : null;

 const handleConfirm = () => {
   try {
     onConfirm();
     showToast('Demande de prolongation envoyée', 'success');
     onClose();
   } catch (error) {
     showToast('Erreur lors de la demande', 'error');
   }
 };

 return (
   <Dialog open={isOpen} onOpenChange={onClose}>
     <DialogContent className="sm:max-w-[425px]">
       <DialogHeader>
         <DialogTitle>Demande de prolongation</DialogTitle>
       </DialogHeader>

       <div className="space-y-4">
         <div className="text-sm text-gray-600">
           <p>Date initiale: {DateUtils.formatDate(originalStartDate || '')}</p>
           <p>Durée initiale: {originalDuration} jours</p>
           {calculatedEndDate && (
             <p>Date de fin prévue: {DateUtils.formatDate(calculatedEndDate)}</p>
           )}
         </div>

         <DialogFooter>
           <Button type="button" variant="outline" onClick={onClose}>
             Annuler
           </Button>
           <Button onClick={handleConfirm}>
             Demander la prolongation
           </Button>
         </DialogFooter>
       </div>
     </DialogContent>
   </Dialog>
 );
};