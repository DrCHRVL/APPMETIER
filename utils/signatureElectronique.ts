// utils/signatureElectronique.ts
//
// Signature apposée au bas des actes exportés en PDF et en Word.
//
// Il ne s'agit PAS d'une signature électronique au sens du règlement eIDAS :
// aucune empreinte cryptographique n'est calculée, aucun certificat n'est
// mobilisé. C'est la reproduction, dans le document, de la mention et du cachet
// que le magistrat appose aujourd'hui à la main — de quoi transmettre au service
// enquêteur un acte prêt à l'emploi, sans le réimprimer pour le signer.
//
// Le cachet est fourni par le magistrat (image téléversée une fois) et conservé
// LOCALEMENT avec les autres réglages de l'application : il n'est pas versionné
// dans le dépôt, et ne quitte pas le poste.

import { SiralBridge } from '@/utils/siralBridge';
import { APP_CONFIG } from '@/config/constants';
import { CHAMP_SIGNATURE_DEFAUT, ChampSignature, mergeChampSignature } from '@/utils/pdfSignatureField';

/** Ce que porte le bas de l'acte, sous le bloc « Fait à …, le … ». */
export interface SignatureElectronique {
  /** Rien, la seule mention, ou la mention et le cachet. */
  mode: 'aucune' | 'mention' | 'mention_cachet';
  /** Mention manuscrite reproduite (« Signé électroniquement : … »). */
  mention: string;
  /** Cachet en data-URI (PNG ou JPEG), téléversé par le magistrat. */
  cachet?: string;
  /** Largeur du cachet dans le document, en pixels (≈ 0,26 mm par pixel). */
  largeurPx: number;
  /**
   * Poser un champ de signature vide au bas du PDF, pour le faire signer
   * ensuite par la carte agent : l'application ne signe pas, elle prépare.
   */
  champActif: boolean;
  /** Emplacement de ce champ sur la dernière page. */
  champ: ChampSignature;
}

export const DEFAULT_SIGNATURE: SignatureElectronique = {
  mode: 'aucune',
  mention: 'Signé électroniquement :',
  largeurPx: 150,
  champActif: false,
  champ: CHAMP_SIGNATURE_DEFAUT,
};

export const mergeSignature = (
  saved: Partial<SignatureElectronique> | null | undefined,
): SignatureElectronique => ({
  ...DEFAULT_SIGNATURE,
  ...(saved || {}),
  champ: mergeChampSignature(saved?.champ),
});

export const loadSignature = async (): Promise<SignatureElectronique> =>
  mergeSignature(
    await SiralBridge.getData<Partial<SignatureElectronique>>(
      APP_CONFIG.STORAGE_KEYS.SIGNATURE_ELECTRONIQUE,
      DEFAULT_SIGNATURE,
    ),
  );

export const saveSignature = async (s: SignatureElectronique): Promise<void> => {
  await SiralBridge.setData(APP_CONFIG.STORAGE_KEYS.SIGNATURE_ELECTRONIQUE, s);
};

/** Vrai si la signature apporte réellement quelque chose au document. */
export const signatureActive = (s: SignatureElectronique | undefined): boolean => {
  if (!s || s.mode === 'aucune') return false;
  if (s.mode === 'mention_cachet') return Boolean(s.mention.trim() || s.cachet);
  return Boolean(s.mention.trim());
};

/** Taille maximale acceptée pour le cachet (le data-URI voyage dans le document). */
export const CACHET_MAX_OCTETS = 1_500_000;

/**
 * Lit une image téléversée en data-URI. Rejette ce qui n'est pas une image ou
 * ce qui dépasse la taille acceptée — un cachet est un petit visuel, pas un scan
 * pleine page.
 */
export const lireCachet = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Le cachet doit être une image (PNG ou JPEG).'));
      return;
    }
    if (file.size > CACHET_MAX_OCTETS) {
      reject(new Error('Image trop lourde : 1,5 Mo au maximum.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(file);
  });
