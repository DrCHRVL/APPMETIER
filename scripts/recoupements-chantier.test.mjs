/**
 * SIRAL — quand le chantier de recoupements part-il tout seul ?
 *
 * La règle tient en une phrase — « une fois par semaine, dans la nuit du samedi
 * au dimanche » — et c'est précisément le genre de phrase qui se traduit mal en
 * code : une nuit chevauche DEUX jours, l'heure est celle du magistrat et non
 * celle du conteneur, et un service qui redémarre ne doit pas relancer un
 * calcul déjà fait. Une nuit manquée, ce sont sept jours de signaux perdus.
 *
 *   node scripts/recoupements-chantier.test.mjs
 */
import { feuRecoupements, estNuitDe, jourLocal } from './attache/ordonnancement.mjs'

let echecs = 0
const ok = (cond, libelle, detail = '') => {
  if (cond) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.error(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

const TZ = 'Europe/Paris'
const feu = (iso, extra = {}) => feuRecoupements({ now: new Date(iso), tz: TZ, ...extra })

console.log('\nLa nuit du samedi au dimanche, et elle seule :')
ok(feu('2026-08-29T23:30:00+02:00').ok, 'samedi 23 h 30 → le chantier part')
ok(feu('2026-08-30T03:00:00+02:00').ok, 'dimanche 3 h → le chantier part (même nuit)')
ok(feu('2026-08-30T06:59:00+02:00').ok, 'dimanche 6 h 59 → encore dans la nuit')
ok(!feu('2026-08-29T21:30:00+02:00').ok, 'samedi 21 h 30 → trop tôt, le magistrat peut être là')
ok(!feu('2026-08-30T08:00:00+02:00').ok, 'dimanche 8 h → la nuit est finie')
ok(!feu('2026-08-30T23:30:00+02:00').ok, 'dimanche 23 h 30 → c\'est la nuit du dimanche au lundi')
ok(!feu('2026-08-26T03:00:00+02:00').ok, 'mercredi 3 h → ce n\'est pas la bonne nuit')

console.log('\nJamais deux fois pour la même semaine :')
ok(!feu('2026-08-30T03:00:00+02:00', { dernierAt: '2026-08-29T23:10:00+02:00' }).ok,
  'un passage à 23 h 10 empêche un second à 3 h du matin')
ok(feu('2026-08-30T03:00:00+02:00', { dernierAt: '2026-08-23T03:00:00+02:00' }).ok,
  'le passage de la semaine précédente ne bloque pas celle-ci')
ok(!feu('2026-08-30T03:00:00+02:00', { auto: false }).ok,
  'automatisme coupé : plus aucun départ tout seul')

console.log('\nL\'heure est celle du magistrat, pas celle du conteneur :')
// 2026-08-30T00:30Z = samedi 29 à 20 h 30 à Los Angeles, dimanche 30 à 2 h 30 à Paris.
ok(estNuitDe(0, new Date('2026-08-30T00:30:00Z'), { tz: 'Europe/Paris' }),
  'dimanche 2 h 30 à Paris → dans la nuit visée')
ok(!estNuitDe(0, new Date('2026-08-30T00:30:00Z'), { tz: 'America/Los_Angeles' }),
  'le même instant, à Los Angeles, est un samedi soir → hors fenêtre')
ok(jourLocal(new Date('2026-08-30T00:30:00Z'), 'Europe/Paris') === 0, 'jourLocal rend bien dimanche à Paris')
ok(jourLocal(new Date('2026-08-30T00:30:00Z'), 'America/Los_Angeles') === 6, 'et samedi à Los Angeles')

console.log('')
if (echecs > 0) {
  console.error(`${echecs} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Chantier de recoupements : la planification est juste.\n')
