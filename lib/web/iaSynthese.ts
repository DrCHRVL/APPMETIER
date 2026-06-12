/**
 * SIRAL — préparation du dossier pour la synthèse IA locale.
 * Convertit l'enquête (CR, actes, mis en cause, documents PDF) en markdown
 * compact — pas de HTML ni de bruit : chaque token compte sur un LLM local.
 */
import type { Enquete } from '@/types/interfaces'

export const IA_PROMPT_KEY = 'ia_synthese_prompt'

export const DEFAULT_IA_PROMPT = `Tu es l'assistant d'un magistrat du parquet. À partir du dossier d'enquête fourni (comptes-rendus, actes, documents), produis en français :

1. **Synthèse** (15 lignes max) : l'affaire, son état, les développements récents.
2. **Mis en cause** : liste avec rôle supposé et éléments à charge connus.
3. **Actes d'enquête** : interceptions, géolocalisations et autres actes, avec leurs échéances.
4. **Éléments matériels** : adresses, véhicules (marque + immatriculation), lignes téléphoniques, sommes/saisies cités dans le dossier.
5. **Points d'attention** : incohérences, échéances proches, actes manquants.

Règles : ne rien inventer — si une information est absente, l'écrire ; citer la source (CR du JJ/MM ou nom du document) pour chaque élément important ; style sobre et factuel.`

function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

/** Markdown compact du dossier. `docTexts` : textes déjà extraits des PDF (optionnel). */
export function buildDossierMarkdown(enquete: Enquete, docTexts?: Array<{ name: string, text: string }>): string {
  const parts: string[] = []
  parts.push(`# Dossier ${enquete.numero}`)
  if (enquete.description) parts.push(`**Objet :** ${stripHtml(enquete.description)}`)
  if (enquete.services?.length) parts.push(`**Services :** ${enquete.services.join(', ')}`)
  if (enquete.dateOP) parts.push(`**Date d'OP :** ${enquete.dateOP}`)

  const mec = enquete.misEnCause || []
  if (mec.length) {
    parts.push('\n## Mis en cause')
    for (const m of mec) parts.push(`- ${m.nom}${m.role ? ` — ${m.role}` : ''}${m.statut ? ` (${m.statut})` : ''}`)
  }

  const ecoutes = enquete.ecoutes || []
  if (ecoutes.length) {
    parts.push('\n## Interceptions')
    for (const e of ecoutes) parts.push(`- ${e.numero}${e.cible ? ` (${e.cible})` : ''} : du ${e.dateDebut} au ${e.dateFin} — ${e.statut}`)
  }
  const geolocs = enquete.geolocalisations || []
  if (geolocs.length) {
    parts.push('\n## Géolocalisations')
    for (const g of geolocs) parts.push(`- ${g.objet} : du ${g.dateDebut} au ${g.dateFin}`)
  }
  const actes = enquete.actes || []
  if (actes.length) {
    parts.push('\n## Autres actes')
    for (const a of actes) parts.push(`- ${(a as { type?: string }).type || 'acte'} : ${stripHtml(String((a as { description?: string }).description || ''))}`.slice(0, 300))
  }

  const crs = [...(enquete.comptesRendus || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (crs.length) {
    parts.push('\n## Comptes-rendus (chronologique)')
    for (const cr of crs) {
      parts.push(`\n### CR du ${cr.date}${cr.enqueteur ? ` — ${cr.enqueteur}` : ''}`)
      parts.push(stripHtml(cr.description || ''))
    }
  }

  if (docTexts?.length) {
    parts.push('\n## Documents (texte extrait)')
    for (const d of docTexts) {
      parts.push(`\n### ${d.name}`)
      parts.push(d.text.slice(0, 12_000))
    }
  }

  return parts.join('\n').slice(0, 380_000)
}

/**
 * Markdown COMPLET du dossier pour une IA externe (Claude web…) : structure
 * de l'enquête + texte intégral des PDF téléversés (autorisations, PV, actes).
 * L'extraction des PDF se fait localement (navigateur ou poste Electron).
 */
export async function exportDossierMarkdown(
  enquete: Enquete,
  onProgress?: (msg: string) => void,
): Promise<{ filename: string, content: string, pdfCount: number, pdfFailed: string[] }> {
  const docs = (enquete.documents || []).filter((d) => d.cheminRelatif.toLowerCase().endsWith('.pdf'))
  const docTexts: Array<{ name: string, text: string }> = []
  const pdfFailed: string[] = []
  const api = window.electronAPI as unknown as { readDocumentText?: (e: string, r: string) => Promise<string> }
  for (let i = 0; i < docs.length; i++) {
    onProgress?.(`Extraction du texte des PDF… (${i + 1}/${docs.length})`)
    try {
      const text = String(await api.readDocumentText?.(enquete.numero, docs[i].cheminRelatif) || '').trim()
      if (text.length > 30) docTexts.push({ name: `${docs[i].cheminRelatif.split('/')[0]} / ${docs[i].nomOriginal}`, text })
      else pdfFailed.push(docs[i].nomOriginal)
    } catch {
      pdfFailed.push(docs[i].nomOriginal)
    }
  }
  const header = [
    '<!-- Export SIRAL pour analyse IA — généré le ' + new Date().toLocaleString('fr-FR') + ' -->',
    '<!-- Contient des données d\'enquête sensibles : à votre seule discrétion. -->',
    '',
  ].join('\n')
  const content = header + buildDossierMarkdown(enquete, docTexts)
  const filename = `dossier-${String(enquete.numero).replace(/[^a-zA-Z0-9._-]/g, '-')}.md`
  return { filename, content, pdfCount: docTexts.length, pdfFailed }
}

export async function iaStatus(): Promise<{ enabled: boolean, model?: string }> {
  try {
    const res = await fetch('/api/ia', { credentials: 'same-origin' })
    if (!res.ok) return { enabled: false }
    return await res.json()
  } catch { return { enabled: false } }
}

export async function runSynthese(system: string, content: string): Promise<string> {
  const res = await fetch('/api/ia', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, content }), credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Synthèse impossible')
  return String(data.text || '')
}
