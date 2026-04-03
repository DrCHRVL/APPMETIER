'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Check, XCircle, Tag } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { tagRequestManager, TagRequest } from '@/utils/tagRequestManager';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { useTags } from '@/hooks/useTags';

interface TagRequestPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TagRequestPopup = ({ isOpen, onClose }: TagRequestPopupProps) => {
  const [requests, setRequests] = useState<TagRequest[]>([]);
  const { user } = useUser();
  const { showToast } = useToast();
  const { addTag } = useTags();

  const loadRequests = useCallback(async () => {
    const pending = await tagRequestManager.getPendingRequests();
    setRequests(pending);
  }, []);

  useEffect(() => {
    if (isOpen) loadRequests();
  }, [isOpen, loadRequests]);

  const handleApprove = async (request: TagRequest) => {
    if (!user) return;
    try {
      await addTag(request.tagValue, request.category as any);
      await tagRequestManager.reviewRequest(request.id, 'approved', user.windowsUsername);
      showToast(`Tag "${request.tagValue}" approuvé et créé`, 'success');
      loadRequests();
    } catch {
      showToast('Erreur lors de l\'approbation', 'error');
    }
  };

  const handleReject = async (request: TagRequest) => {
    if (!user) return;
    await tagRequestManager.reviewRequest(request.id, 'rejected', user.windowsUsername);
    showToast(`Demande de tag "${request.tagValue}" rejetée`, 'info');
    loadRequests();
  };

  if (!isOpen || requests.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Tag className="h-4 w-4 text-emerald-600" />
            Demandes de création de tags
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
              {requests.length}
            </Badge>
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {requests.map(req => (
            <div key={req.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{req.tagValue}</div>
                <div className="text-xs text-gray-500">
                  {req.category === 'services' ? 'Service' : 'Infraction'} —
                  Demandé par {req.requestedBy} le {new Date(req.requestedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-green-600 hover:bg-green-50"
                  onClick={() => handleApprove(req)}
                  title="Approuver"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                  onClick={() => handleReject(req)}
                  title="Rejeter"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
