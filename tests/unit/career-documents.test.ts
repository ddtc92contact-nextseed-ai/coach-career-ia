import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkDocument,
  MAX_DOCUMENT_BYTES,
  safeFileName,
  sniffDocumentType,
} from "@/lib/career/documents";
import { createKeyring, decryptBytes, DecryptionError, encryptBytes } from "@/lib/crypto";

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

describe("pièces justificatives", () => {
  it("détecte le type réel d'après le contenu", () => {
    expect(sniffDocumentType(PDF)).toBe("application/pdf");
    expect(sniffDocumentType(PNG)).toBe("image/png");
    expect(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffDocumentType(WEBP)).toBe("image/webp");
    expect(sniffDocumentType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("applique les limites de taille et de type", () => {
    expect(checkDocument(Buffer.alloc(0))).toEqual({ ok: false, error: "fileRequired" });
    expect(checkDocument(Buffer.from("MZ executable"))).toEqual({ ok: false, error: "fileType" });
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    expect(checkDocument(big)).toEqual({ ok: false, error: "fileTooLarge" });
    expect(checkDocument(PDF)).toEqual({ ok: true, mimeType: "application/pdf" });
  });

  it("produit un nom de téléchargement sûr avec l'extension du type réel", () => {
    expect(safeFileName('../../etc/pass"wd.exe', "application/pdf")).toBe("pass_wd.pdf");
    expect(safeFileName("Attestation été.png", "image/png")).toBe("Attestation_ete.png");
    expect(safeFileName("", "image/jpeg")).toBe("document.jpg");
  });
});

describe("chiffrement binaire", () => {
  const keyring = createKeyring({ currentKey: randomBytes(32).toString("base64") });

  it("chiffre et déchiffre un fichier, lié à son contexte", () => {
    const encrypted = encryptBytes(PDF, { keyring, aad: "proof-file:a/b" });
    expect(encrypted.includes(PDF)).toBe(false);
    expect(decryptBytes(encrypted, { keyring, aad: "proof-file:a/b" }).equals(PDF)).toBe(true);
    expect(() => decryptBytes(encrypted, { keyring, aad: "proof-file:c/d" })).toThrow(
      DecryptionError,
    );
  });

  it("rejette un fichier altéré", () => {
    const encrypted = encryptBytes(PDF, { keyring });
    encrypted[encrypted.length - 1]! ^= 1;
    expect(() => decryptBytes(encrypted, { keyring })).toThrow(DecryptionError);
    expect(() => decryptBytes(Buffer.from("nope"), { keyring })).toThrow(DecryptionError);
  });
});
