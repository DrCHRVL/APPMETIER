'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, RefreshCw, Clock, Monitor, FileText, Filter } from 'lucide-react';
import { HeartbeatManager } from '@/utils/heartbeatManager';
import { AuditLogger } from '@/utils/auditLogger';
import { AuditLogEntry, UserHeartbeat } from '@/types/userTypes';
import { useUser } from '@/contexts/UserContext';

// ──────────────────────────────────────────────
// LABELS POUR LE JOURNAL D'AUDIT
// ──────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  create_enquete: 'Création enquête',
  archive_enquete: 'Archivage enquête',
  delete_enquete: 'Suppression enquête',
  unarchive_enquete: 'Désarchivage enquête',
  update_enquete: 'Modification enquête',
  add_cr: 'Ajout CR',
  pin_overboard: 'Pin Overboard',
  hide_from_ja: 'Masquage JA',
  user_login: 'Connexion',
  user_added: 'Utilisateur ajouté',
  user_role_changed: 'Rôle modifié',
  tag_created: 'Tag créé',
  tag_deleted: 'Tag supprimé',
  tag_request_approved: 'Tag approuvé',
  tag_request_rejected: 'Tag refusé',
  settings_changed: 'Paramètres modifiés',
  backup_created: 'Backup créé',
};

const ACTION_COLORS: Record<string, string> = {
  create_enquete: 'bg-green-100 text-green-700',
  archive_enquete: 'bg-orange-100 text-orange-700',
  delete_enquete: 'bg-red-100 text-red-700',
  user_login: 'bg-blue-100 text-blue-700',
  pin_overboard: 'bg-amber-100 text-amber-700',
  hide_from_ja: 'bg-purple-100 text-purple-700',
  settings_changed: 'bg-gray-100 text-gray-700',
};

export const AdminDashboardPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const [onlineUsers, setOnlineUsers] = useState<(UserHeartbeat & { isOnline: boolean })[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'users' | 'audit'>('users');
  const [auditFilter, setAuditFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [users, log] = await Promise.all([
        HeartbeatManager.getOnlineUsers(),
        AuditLogger.getLog(),
      ]);
      setOnlineUsers(users);
      setAuditLog(log);
    } catch (error) {
      console.error('Dashboard refresh error:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const onlineCount = onlineUsers.filter(u => u.isOnline).length;

  const filteredLog = auditFilter
    ? auditLog.filter(e => e.action === auditFilter)
    : auditLog;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const timeSince = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return 'à l\'instant';
    if (diff < 3600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
    if (diff < 86400_000) return `il y a ${Math.floor(diff / 3600_000)}h`;
    return formatDate(iso);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800">Tableau de bord</h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Section toggle */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setActiveSection('users')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            activeSection === 'users' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-4 w-4" />
          Utilisateurs connectés
          {onlineCount > 0 && (
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
              {onlineCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSection('audit')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            activeSection === 'audit' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="h-4 w-4" />
          Journal d'audit
          <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full">
            {auditLog.length}
          </span>
        </button>
      </div>

      {/* Connected users */}
      {activeSection === 'users' && (
        <div className="space-y-2">
          {onlineUsers.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              Aucun heartbeat détecté
            </div>
          )}
          {onlineUsers
            .sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0))
            .map((user, i) => (
            <div
              key={`${user.username}-${i}`}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                user.isOnline
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${user.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                <div>
                  <div className="text-sm font-medium text-gray-800">{user.displayName}</div>
                  <div className="text-[11px] text-gray-500">{user.username}</div>
                </div>
              </div>
              <div className="text-right">
                {user.activeContentieux && (
                  <div className="text-xs text-gray-600 flex items-center gap-1">
                    <Monitor className="h-3 w-3" />
                    {user.activeContentieux}
                  </div>
                )}
                <div className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  {timeSince(user.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Audit log */}
      {activeSection === 'audit' && (
        <div className="space-y-3">
          {/* Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-gray-400" />
            <select
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="text-xs border border-gray-300 rounded-md px-2 py-1.5"
            >
              <option value="">Toutes les actions</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400 ml-auto">
              {filteredLog.length} entrée{filteredLog.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Log entries */}
          <div className="max-h-[55vh] overflow-y-auto space-y-1.5">
            {filteredLog.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                Aucune entrée dans le journal
              </div>
            )}
            {filteredLog.map((entry) => {
              const colorClass = ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-600';
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-white border border-gray-100 hover:bg-gray-50"
                >
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${colorClass}`}>
                    {ACTION_LABELS[entry.action] || entry.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-700 truncate">
                      {entry.details || '—'}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {entry.displayName} · {formatDate(entry.timestamp)}
                      {entry.contentieuxId && ` · ${entry.contentieuxId}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
