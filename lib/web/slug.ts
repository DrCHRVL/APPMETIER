/**
 * SIRAL — identifiants d'entrées de l'attaché (skills, trames, base de
 * connaissances), côté navigateur.
 *
 * entrySlug est le MIROIR EXACT des règles serveur (safeSkillName,
 * safeName, safeKbId — scripts/attache/{skills,trames,kb}.mjs) : les deux
 * côtés doivent écrire le même nom de fichier pour le même nom d'entrée —
 * toute évolution se fait ICI et dans les trois fonctions serveur à la fois.
 */

export function entrySlug(nom: string): string {
  return String(nom).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** Empreinte courte et stable d'une chaîne (djb2) — suffixe anti-collision. */
export function hash8(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}
