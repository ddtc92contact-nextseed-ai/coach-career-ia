import { strFromU8, unzipSync } from "fflate";
import { ImportError } from "./errors";
import { IMPORT_LIMITS } from "./shared";

/**
 * Extraction du texte d'un CV (PDF ou DOCX), en mémoire uniquement : le
 * fichier n'est jamais écrit sur disque. Le type est détecté sur le contenu,
 * pas sur l'extension.
 */

const DOCX_MAIN = "word/document.xml";
/** Taille décompressée maximale du corps d'un DOCX. */
const DOCX_XML_MAX_BYTES = 10 * 1024 * 1024;

export type SniffedType = "pdf" | "zip";

export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "zip"; // PK\3\4 (DOCX, archive LinkedIn)
  }
  return null;
}

/** Décompresse les seules entrées retenues, en refusant celles qui dépassent `maxBytes`. */
export function unzipSelected(
  bytes: Uint8Array,
  keep: (name: string) => boolean,
  maxBytes: number,
): Record<string, Uint8Array> {
  let tooLarge = false;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!keep(file.name)) return false;
      if (file.originalSize > maxBytes) {
        tooLarge = true;
        return false;
      }
      return true;
    },
  });
  if (tooLarge) throw new ImportError("linkedinTooLarge");
  return files;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Texte d'un `word/document.xml` : un paragraphe par ligne. */
export function docxXmlToText(xml: string): string {
  return xml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      paragraph
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:(?:br|cr)\/>/g, "\n")
        .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (_m, text?: string) =>
          text !== undefined ? decodeXml(text) : "",
        ),
    )
    .join("\n");
}

/** Espaces normalisés, lignes vides multiples réduites, longueur bornée. */
export function normalizeText(text: string, maxChars: number): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t  ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js peut détacher le tampon reçu : on lui passe une copie.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, {
    filter: (file) => file.name === DOCX_MAIN && file.originalSize <= DOCX_XML_MAX_BYTES,
  });
  const xml = files[DOCX_MAIN];
  if (!xml) throw new ImportError("cvType");
  return docxXmlToText(strFromU8(xml));
}

/** Texte d'un CV PDF ou DOCX. Un PDF scanné (sans texte) donne `cvEmpty`. */
export async function extractCvText(bytes: Uint8Array): Promise<string> {
  if (bytes.length > IMPORT_LIMITS.cvMaxBytes) throw new ImportError("cvTooLarge");
  const type = sniffType(bytes);
  let raw: string;
  try {
    if (type === "pdf") raw = await pdfText(bytes);
    else if (type === "zip") raw = docxText(bytes);
    else throw new ImportError("cvType");
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // PDF chiffré ou corrompu, archive illisible.
    throw new ImportError("cvType");
  }
  const text = normalizeText(raw, IMPORT_LIMITS.cvMaxChars);
  if (text.replace(/\s/g, "").length < 40) throw new ImportError("cvEmpty");
  return text;
}
