import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Pin } from 'lucide-react';

interface OverboardPinnedAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OverboardPinnedAlertModal = ({ isOpen, onClose }: OverboardPinnedAlertModalProps) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="max-w-sm bg-white">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <Pin className="h-4 w-4 text-amber-500" />
          Enquête suivie par la hiérarchie
        </DialogTitle>
      </DialogHeader>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-sm text-amber-800">
          Cette enquête est suivie par la hiérarchie. Votre date d'OP envisagée pourra utilement
          être communiquée dès à présent.
        </p>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>OK</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
