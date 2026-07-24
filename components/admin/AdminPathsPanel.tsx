'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

/**
 * Stockage des données : le serveur SIRAL chiffré est l'unique lieu de
 * stockage — aucun chemin réseau à configurer. Panneau purement informatif.
 */
export const AdminPathsPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Stockage des données</h3>
        <p className="text-sm text-gray-500">
          Les données sont stockées de façon chiffrée sur le serveur SIRAL.
          Aucun chemin réseau n'est à configurer.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-blue-500" />
          Serveur SIRAL chiffré
        </h4>
        <ul className="text-xs text-gray-600 space-y-2 list-disc pl-5">
          <li>
            <strong>Chiffrement de bout en bout</strong> : le serveur ne conserve que des
            coffres illisibles ; lui seul ne peut rien déchiffrer.
          </li>
          <li>
            <strong>Sauvegardes automatiques</strong> : chaque enregistrement crée une
            nouvelle version horodatée côté serveur (historique immuable) — aucune
            sauvegarde manuelle n'est nécessaire.
          </li>
          <li>
            <strong>Copie de secours locale</strong> : l'application conserve aussi des
            instantanés dans le navigateur (cache hors-ligne). Pour une copie sur le
            commun Windows, utilisez « Configurer chemin » au niveau d'une enquête.
          </li>
        </ul>
      </div>
    </div>
  );
};
