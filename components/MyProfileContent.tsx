'use client';

import React, { useMemo } from 'react';
import { User, Shield, Layers, Package, Users as UsersIcon, Info, Gavel, Scale } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { UserManager } from '@/utils/userManager';
import type {
  ContentieuxRole,
  GlobalRole,
  ModuleId,
  UserProfile,
} from '@/types/userTypes';

// ──────────────────────────────────────────────
// LIBELLÉS & EXPLICATIONS
// ──────────────────────────────────────────────

const GLOBAL_ROLE_LABELS: Record<NonNullable<GlobalRole>, string> = {
  admin: 'Administrateur',
  pra: 'PR / PRA',
  vice_proc: 'Vice-procureur',
};

const CONTENTIEUX_ROLE_LABELS: Record<ContentieuxRole, string> = {
  magistrat: 'Magistrat en charge',
  ja: 'Juriste assistant(e)',
};

const MODULE_LABELS: Record<ModuleId, string> = {
  air: 'Suivi AIR',
  instructions: 'Instructions judiciaires',
};

// Explications publiques (admin intentionnellement absent — reste confidentiel)
const GLOBAL_ROLE_EXPLANATIONS: Record<Exclude<NonNullable<GlobalRole>, 'admin'>, {
  short: string;
  can: string[];
  cannot: string[];
}> = {
  pra: {
    short: "Accès transversal à tous les contentieux avec droits d'écriture.",
    can: [
      'Consulter tous les contentieux',
      'Créer et modifier des enquêtes partout',
      'Voir les statistiques globales',
      "Épingler des enquêtes sur l'Overboard",
    ],
    cannot: [
      'Supprimer des enquêtes, des CR ou des actes',
      'Gérer les tags, alertes, sauvegardes',
    ],
  },
  vice_proc: {
    short: 'Accès transversal en lecture seule à tous les contentieux.',
    can: [
      'Consulter tous les contentieux',
      'Voir les statistiques globales',
      "Épingler des enquêtes sur l'Overboard",
    ],
    cannot: [
      'Créer, modifier ou supprimer des enquêtes',
      'Gérer les tags, alertes, sauvegardes',
    ],
  },
};

const CONTENTIEUX_ROLE_EXPLANATIONS: Record<ContentieuxRole, {
  short: string;
  can: string[];
  cannot: string[];
}> = {
  magistrat: {
    short: "Magistrat référent du contentieux — droits complets sur ses données.",
    can: [
      'Consulter et créer des enquêtes',
      'Modifier les enquêtes, CR et actes',
      'Supprimer des enquêtes, CR, actes',
      'Gérer les tags, alertes et sauvegardes du contentieux',
      'Voir les statistiques du contentieux',
    ],
    cannot: [
      "Accéder aux contentieux dont il n'est pas référent",
    ],
  },
  ja: {
    short: "Juriste assistant(e) — appui opérationnel sur le contentieux.",
    can: [
      'Consulter les enquêtes du contentieux',
      'Créer de nouvelles enquêtes',
      'Modifier les enquêtes, CR et actes',
      'Voir les statistiques du contentieux',
    ],
    cannot: [
      'Supprimer des enquêtes, CR ou actes',
      'Gérer les tags, alertes ou sauvegardes',
    ],
  },
};

// ──────────────────────────────────────────────
// COMPOSANTS UTILITAIRES
// ──────────────────────────────────────────────

const RoleBadge = ({ role, color }: { role: string; color?: string }) => (
  <span
    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide"
    style={color ? { backgroundColor: `${color}20`, color, border: `1px solid ${color}40` } : undefined}
  >
    {role}
  </span>
);

const PermissionList = ({
  can,
  cannot,
}: {
  can: string[];
  cannot: string[];
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">Peut</p>
      <ul className="space-y-1">
        {can.map((c, i) => (
          <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
            <span className="text-emerald-500 mt-0.5">✓</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700 mb-1.5">Ne peut pas</p>
      <ul className="space-y-1">
        {cannot.map((c, i) => (
          <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
            <span className="text-rose-400 mt-0.5">✕</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ──────────────────────────────────────────────

export const MyProfileContent = () => {
  const { user, accessibleContentieux } = useUser();

  // Liste complète des utilisateurs pour afficher les co-équipiers par contentieux
  const allUsers = useMemo<UserProfile[]>(() => {
    return UserManager.getInstance().getAllUsers();
  }, []);

  if (!user) {
    return (
      <div className="text-sm text-gray-500">Profil indisponible.</div>
    );
  }

  // Le viewer est-il admin ? Si non, on ne révèle jamais le rôle admin des autres.
  const viewerIsAdmin = user.globalRole === 'admin';

  // Son rôle global à lui (affiché tel quel — l'utilisateur connaît son propre statut)
  const ownGlobalRoleLabel = user.globalRole ? GLOBAL_ROLE_LABELS[user.globalRole] : null;

  // Assignations utilisateur → map par contentieux
  const ownAssignmentByCtx = new Map<string, ContentieuxRole>();
  for (const a of user.contentieux) ownAssignmentByCtx.set(a.contentieuxId, a.role);

  // Pour chaque contentieux accessible, regrouper les utilisateurs assignés (magistrats + JA)
  const usersByCtx = new Map<string, { magistrats: UserProfile[]; jas: UserProfile[] }>();
  for (const ctxDef of accessibleContentieux) {
    const magistrats: UserProfile[] = [];
    const jas: UserProfile[] = [];
    for (const u of allUsers) {
      const a = u.contentieux.find(c => c.contentieuxId === ctxDef.id);
      if (!a) continue;
      if (a.role === 'magistrat') magistrats.push(u);
      else if (a.role === 'ja') jas.push(u);
    }
    // Tri alphabétique par displayName
    magistrats.sort((a, b) => a.displayName.localeCompare(b.displayName));
    jas.sort((a, b) => a.displayName.localeCompare(b.displayName));
    usersByCtx.set(ctxDef.id, { magistrats, jas });
  }

  // Rôles à expliquer : tous les rôles que possède le viewer + les rôles génériques
  // MAIS on masque l'explication "admin" — elle reste confidentielle.
  const globalRolesToExplain = (Object.keys(GLOBAL_ROLE_EXPLANATIONS) as Array<keyof typeof GLOBAL_ROLE_EXPLANATIONS>);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Carte identité ── */}
      <section className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-100 rounded-xl">
            <User className="h-6 w-6 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Votre identité</p>
            <h2 className="text-xl font-bold text-gray-900 truncate">{user.displayName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Identifiant Windows : <span className="font-mono">{user.windowsUsername}</span></p>
          </div>
          {ownGlobalRoleLabel && (
            <div className="flex-shrink-0">
              <RoleBadge role={ownGlobalRoleLabel} />
            </div>
          )}
        </div>
      </section>

      {/* ── Rôle global ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Rôle global</h3>
        </div>

        {user.globalRole === 'admin' ? (
          <div>
            <p className="text-sm text-gray-700">
              Vous disposez du rôle <span className="font-semibold">Administrateur</span>.
              Vous avez tous les droits sur tous les contentieux ainsi que la gestion des utilisateurs et des modules.
            </p>
          </div>
        ) : user.globalRole && user.globalRole !== 'admin' ? (
          <div>
            <p className="text-sm text-gray-700">
              Vous disposez du rôle <span className="font-semibold">{GLOBAL_ROLE_LABELS[user.globalRole]}</span>.
            </p>
            <p className="text-xs text-gray-500 mt-1">{GLOBAL_ROLE_EXPLANATIONS[user.globalRole].short}</p>
            <PermissionList
              can={GLOBAL_ROLE_EXPLANATIONS[user.globalRole].can}
              cannot={GLOBAL_ROLE_EXPLANATIONS[user.globalRole].cannot}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">
            Aucun rôle global — vos droits dépendent uniquement de vos affectations aux contentieux ci-dessous.
          </p>
        )}
      </section>

      {/* ── Statuts par contentieux ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Vos statuts par contentieux</h3>
        </div>

        {accessibleContentieux.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Aucun contentieux accessible pour l&apos;instant.</p>
        ) : (
          <div className="space-y-3">
            {accessibleContentieux
              .slice()
              .sort((a, b) => a.order - b.order)
              .map(ctxDef => {
                const role = ownAssignmentByCtx.get(ctxDef.id);
                // Si pas d'affectation directe mais accès global (pra/vice_proc/admin)
                if (!role) {
                  return (
                    <div key={ctxDef.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50/60">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ctxDef.color }} />
                        <span className="text-sm font-semibold text-gray-800">{ctxDef.label}</span>
                        <span className="ml-auto text-[11px] text-gray-500 italic">Accès via rôle global</span>
                      </div>
                    </div>
                  );
                }
                const expl = CONTENTIEUX_ROLE_EXPLANATIONS[role];
                return (
                  <div key={ctxDef.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ctxDef.color }} />
                      <span className="text-sm font-semibold text-gray-800">{ctxDef.label}</span>
                      <RoleBadge role={CONTENTIEUX_ROLE_LABELS[role]} color={ctxDef.color} />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{expl.short}</p>
                    <PermissionList can={expl.can} cannot={expl.cannot} />
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ── Modules activés ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Modules activés</h3>
        </div>
        {user.modules.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Aucun module optionnel activé.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {user.modules.map(m => (
              <li key={m} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {MODULE_LABELS[m] ?? m}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Qui sont les autres utilisateurs des contentieux ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <UsersIcon className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Les autres utilisateurs</h3>
        </div>

        {accessibleContentieux.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Aucun contentieux à afficher.</p>
        ) : (
          <div className="space-y-4">
            {accessibleContentieux
              .slice()
              .sort((a, b) => a.order - b.order)
              .map(ctxDef => {
                const groups = usersByCtx.get(ctxDef.id);
                const magistrats = groups?.magistrats ?? [];
                const jas = groups?.jas ?? [];
                const magistratNames = magistrats.map(m => m.displayName);

                return (
                  <div key={ctxDef.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ctxDef.color }} />
                      <span className="text-sm font-semibold text-gray-800">{ctxDef.label}</span>
                    </div>

                    {/* Magistrat(s) référent(s) */}
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Gavel className="h-3.5 w-3.5 text-gray-500" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                          {magistratNames.length > 1 ? 'Magistrats référents' : 'Magistrat référent'}
                        </span>
                      </div>
                      {magistratNames.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucun magistrat référent désigné.</p>
                      ) : (
                        <p className="text-sm text-gray-800 font-medium">
                          {formatReferentList(magistratNames)}
                        </p>
                      )}
                    </div>

                    {/* Juristes assistants */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Scale className="h-3.5 w-3.5 text-gray-500" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                          Juriste(s) assistant(e)(s)
                        </span>
                      </div>
                      {jas.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucun(e) juriste assistant(e).</p>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {jas.map(u => (
                            <li
                              key={u.windowsUsername}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-700"
                            >
                              {u.displayName}
                              {u.windowsUsername === user.windowsUsername && (
                                <span className="text-[10px] text-emerald-700 font-semibold">(vous)</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        <p className="text-[11px] text-gray-400 italic mt-3">
          Les utilisateurs avec un rôle global (PR / PRA, vice-procureur) ont également accès aux contentieux
          {viewerIsAdmin ? ' ; ils ne sont pas listés ici.' : '.'}
        </p>
      </section>

      {/* ── Comprendre les statuts (légende générale) ── */}
      <section className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
            Comprendre les statuts
          </h3>
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Il existe deux types de statuts : un <span className="font-semibold">rôle global</span> (transversal)
          et un <span className="font-semibold">rôle par contentieux</span> (spécifique). Le plus permissif des
          deux s&apos;applique quand un utilisateur cumule les deux.
        </p>

        {/* Rôles contentieux */}
        <div className="space-y-3 mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Rôles par contentieux</p>
          {(Object.keys(CONTENTIEUX_ROLE_EXPLANATIONS) as ContentieuxRole[]).map(role => {
            const expl = CONTENTIEUX_ROLE_EXPLANATIONS[role];
            return (
              <div key={role} className="border border-gray-100 rounded-lg p-3 bg-white">
                <div className="flex items-center gap-2 mb-1">
                  <RoleBadge role={CONTENTIEUX_ROLE_LABELS[role]} />
                  <span className="text-xs text-gray-500">{expl.short}</span>
                </div>
                <PermissionList can={expl.can} cannot={expl.cannot} />
              </div>
            );
          })}
        </div>

        {/* Rôles globaux (sans admin) */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Rôles globaux</p>
          {globalRolesToExplain.map(role => {
            const expl = GLOBAL_ROLE_EXPLANATIONS[role];
            return (
              <div key={role} className="border border-gray-100 rounded-lg p-3 bg-white">
                <div className="flex items-center gap-2 mb-1">
                  <RoleBadge role={GLOBAL_ROLE_LABELS[role]} />
                  <span className="text-xs text-gray-500">{expl.short}</span>
                </div>
                <PermissionList can={expl.can} cannot={expl.cannot} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

// Formate une liste de noms de référents avec virgules + "et" final.
function formatReferentList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}
