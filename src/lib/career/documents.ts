/**
 * Règles des pièces justificatives envoyées par le candidat : taille, types
 * acceptés (détectés sur le contenu, pas sur l'extension ni le type annoncé
 * par le navigateur) et quota.
 */

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_USER = 30;

export const DOCUMENT_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type DocumentMimeType = keyof typeof DOCUMENT_TYPES;

/** Valeur de l'attribut `accept` du champ fichier. */
export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_TYPES).join(",");

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Type réel d'un fichier d'après ses premiers octets, ou `null` s'il n'est pas accepté. */
export function sniffDocumentType(bytes: Uint8Array): DocumentMimeType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp"; // RIFF....WEBP
  }
  return null;
}

export type DocumentCheck =
  | { ok: true; mimeType: DocumentMimeType }
  | { ok: false; error: "fileRequired" | "fileTooLarge" | "fileType" };

export function checkDocument(bytes: Uint8Array): DocumentCheck {
  if (bytes.length === 0) return { ok: false, error: "fileRequired" };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, error: "fileTooLarge" };
  const mimeType = sniffDocumentType(bytes);
  return mimeType ? { ok: true, mimeType } : { ok: false, error: "fileType" };
}

/**
 * Contrôle côté navigateur, avant l'envoi : un fichier au-delà de la limite
 * de corps des actions serveur (`bodySizeLimit`) ferait échouer la requête
 * avant toute validation. Le contenu reste vérifié côté serveur.
 */
export function checkDocumentSize(file: { size: number } | null | undefined) {
  if (!file || file.size === 0) return "fileRequired" as const;
  if (file.size > MAX_DOCUMENT_BYTES) return "fileTooLarge" as const;
  return null;
}

/** Nom de fichier sûr pour l'en-tête `Content-Disposition` (repli ASCII). */
export function safeFileName(name: string, mimeType: DocumentMimeType): string {
  const base = (name.split(/[/\\]/).pop() ?? "")
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || "document"}.${DOCUMENT_TYPES[mimeType]}`;
}
