import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { History } from 'lucide-react';
import { ModificationEntry } from '@/types/interfaces';

interface ModificationsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  modifications: ModificationEntry[];
  enqueteNumero: string;
}

interface GroupedByUser {
  username: string;
  displayName: string;
  entries: ModificationEntry[];
}

function groupByUser(modifications: ModificationEntry[]): GroupedByUser[] {
  const map = new Map<string, GroupedByUser>();
  for (const m of modifications) {
    const existing = map.get(m.user.username);
    if (existing) {
      existing.entries.push(m);
    } else {
      map.set(m.user.username, {
        username: m.user.username,
        displayName: m.user.displayName,
        entries: [m],
      });
    }
  }
  // Tri : utilisateur dont la modification la plus récente est la plus tardive en premier
  return Array.from(map.values()).sort((a, b) => {
    const aMax = a.entries[a.entries.length - 1].timestamp;
    const bMax = b.entries[b.entries.length - 1].timestamp;
    return bMax.localeCompare(aMax);
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Couleur stable dérivée du username (palette restreinte)
const USER_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
];
function colorForUser(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

export const ModificationsPopup: React.FC<ModificationsPopupProps> = ({
  isOpen,
  onClose,
  modifications,
  enqueteNumero,
}) => {
  const groups = React.useMemo(() => groupByUser(modifications), [modifications]);
  const total = modifications.length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-red-600" />
            {total} modification{total > 1 ? 's' : ''} non vue{total > 1 ? 's' : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-gray-500 mb-2">
          Sur l'enquête <span className="font-semibold">N° {enqueteNumero}</span> depuis votre dernière consultation.
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
          {groups.map((group) => (
            <div key={group.username} className="border border-gray-100 rounded-lg p-2.5 bg-gray-50/60">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant="outline" className={`text-[11px] py-0 px-2 ${colorForUser(group.username)}`}>
                  {group.displayName}
                </Badge>
                <span className="text-[10px] text-gray-500">
                  ({group.entries.length} modif{group.entries.length > 1 ? 's' : ''})
                </span>
              </div>
              <ul className="space-y-1 ml-1">
                {group.entries.map((m) => (
                  <li key={m.id} className="text-xs text-gray-700 flex items-start gap-2">
                    <span className="text-gray-400 text-[10px] mt-0.5 flex-shrink-0 tabular-nums">
                      {formatTimestamp(m.timestamp)}
                    </span>
                    <span>{m.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={onClose}>
            J'ai vu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
