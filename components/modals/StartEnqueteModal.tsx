import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
interface StartEnqueteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
}

export const StartEnqueteModal = ({
  isOpen,
  onClose,
  onConfirm
}: StartEnqueteModalProps) => {
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const { showToast } = useToast();
  const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  try {
    onConfirm(startDate);
    showToast('Date de début définie avec succès', 'success');
    onClose();
  } catch (error) {
    showToast('Erreur lors de la définition de la date', 'error');
  }
};

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="relative">
          <DialogTitle>Débuter le suivi de l'enquête</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Date de début</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit">
              Confirmer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};