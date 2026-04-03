'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Check, X, Clock, Trash2, RefreshCw } from 'lucide-react';
import { tagRequestManager, TagRequest } from '@/utils/tagRequestManager';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:  { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approuvé',   color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Refusé',     color: 'bg-red-100 text-red-700' },
};

const CATEGORY_LABELS: Record<string, string> = {
  services: 'Service',
  infractions: 'Infraction',
};

export const AdminTagHistoryPanel = () => {
  const { isAdmin: checkIsAdmin, user } = useUser();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<TagRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const all = await tagRequestManager.getRequests();
      setRequests(all.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()));
    } catch (error) {
      console.error('Tag history load error:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    await tagRequestManager.reviewRequest(id, status, user?.windowsUsername || 'admin');
    showToast(status === 'approved' ? 'Demande approuvée' : 'Demande refusée', 'success');
    loadRequests();
  };

  const handleClearReviewed = async () => {
    await tagRequestManager.clearReviewed();
    showToast('Historique nettoyé', 'success');
    loadRequests();
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const filtered = statusFilter
    ? requests.filter(r => r.status === statusFilter)
    : requests;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Historique des demandes de tags</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {pendingCount > 0 ? `${pendingCount} demande${pendingCount > 1 ? 's' : ''} en attente` : 'Aucune demande en attente'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadRequests}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {requests.some(r => r.status !== 'pending') && (
            <button
              onClick={handleClearReviewed}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Nettoyer traités
            </button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {['', 'pending', 'approved', 'rejected'].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === f ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f === '' ? 'Tout' : STATUS_LABELS[f]?.label}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 px-1 py-0.5 bg-amber-200 text-amber-800 text-[10px] rounded-full font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests list */}
      <div className="max-h-[55vh] overflow-y-auto space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            Aucune demande
          </div>
        )}
        {filtered.map(req => {
          const statusInfo = STATUS_LABELS[req.status];
          return (
            <div
              key={req.id}
              className="p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-800">{req.tagValue}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                      {CATEGORY_LABELS[req.category] || req.category}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Demandé par <span className="font-medium">{req.requestedBy}</span> · {formatDate(req.requestedAt)}
                    {req.contentieuxId && ` · ${req.contentieuxId}`}
                  </div>
                  {req.reviewedBy && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Traité par {req.reviewedBy} · {formatDate(req.reviewedAt!)}
                    </div>
                  )}
                </div>

                {/* Action buttons for pending */}
                {req.status === 'pending' && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleReview(req.id, 'approved')}
                      className="p-1.5 bg-green-100 hover:bg-green-200 rounded-md transition-colors"
                      title="Approuver"
                    >
                      <Check className="h-3.5 w-3.5 text-green-700" />
                    </button>
                    <button
                      onClick={() => handleReview(req.id, 'rejected')}
                      className="p-1.5 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                      title="Refuser"
                    >
                      <X className="h-3.5 w-3.5 text-red-700" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
