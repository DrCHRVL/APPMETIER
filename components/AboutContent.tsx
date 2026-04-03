'use client';

import React from 'react';
import { Shield, Code, Building2, Calendar, Scale } from 'lucide-react';

export const AboutContent = () => {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex flex-col items-center justify-center h-full py-8">
      {/* Logo / Branding */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 shadow-lg mb-4">
          <Scale className="h-10 w-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          APP MÉTIER
        </h1>
        <p className="text-sm text-gray-500 mt-1 font-medium tracking-wide uppercase">
          Gestion des enquêtes pénales
        </p>
      </div>

      {/* Carte auteur */}
      <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-xl p-6 max-w-sm w-full shadow-sm mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Code className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Conception & développement
            </p>
            <p className="text-lg font-bold text-gray-900">
              Audran CHEVALIER
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span>Parquet du Tribunal Judiciaire d&apos;Amiens</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span>2025–{currentYear}</span>
          </div>
        </div>
      </div>

      {/* Mention légale */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 max-w-sm w-full">
        <div className="flex items-start gap-2.5">
          <Shield className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 leading-relaxed">
            <p className="font-semibold mb-1">Propriété intellectuelle</p>
            <p>
              Cette application est la propriété exclusive de son auteur.
              Toute reproduction, diffusion ou utilisation non autorisée
              est strictement interdite.
            </p>
          </div>
        </div>
      </div>

      {/* Version */}
      <p className="text-xs text-gray-300 mt-8">
        APP MÉTIER — v1.0
      </p>
    </div>
  );
};
