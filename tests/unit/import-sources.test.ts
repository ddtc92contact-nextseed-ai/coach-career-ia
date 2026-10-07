import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvRecords, parseCsv } from "@/lib/import/csv";
import { importErrorCode } from "@/lib/import/errors";
import { AiError } from "@/lib/ai";
import { docxXmlToText, extractCvText } from "@/lib/import/extract";
import { fetchGithubProfile, readmeExcerpt } from "@/lib/import/github";
import { parseLinkedInExport, parseLinkedInMonth } from "@/lib/import/linkedin";
import {
  createLinkTable,
  identityTerms,
  isIdentityUrl,
  maskContacts,
  redactTerms,
  redactText,
} from "@/lib/import/pseudonymise";
import { checkImportFile, IMPORT_LIMITS } from "@/lib/import/shared";
import { makeDocx, makePdf, makeZip } from "../helpers/documents";
import { githubFixtureFetch } from "../fixtures/import/cases";

const CV_LINES = [
  "Alex Exemple",
  "Développeur backend, 6 ans d’expérience en Node.js et PostgreSQL.",
  "Mise en place d’une CI qui divise par deux le temps de livraison.",
];

describe("Extraction du texte d'un CV", () => {
  it("lit un PDF texte", async () => {
    const text = await extractCvText(makePdf(["Alex Exemple (Été 2024)", ...CV_LINES.slice(1)]));
    expect(text).toContain("Alex Exemple (Été 2024)");
    expect(text).toContain("PostgreSQL");
  });

  it("lit un DOCX (un paragraphe par ligne, entités décodées)", async () => {
    const text = await extractCvText(makeDocx([...CV_LINES, "R&D <interne>"]));
    expect(text.split("\n")).toEqual([...CV_LINES, "R&D <interne>"]);
  });

  it("décode tabulations, sauts de ligne et entités numériques", () => {
    expect(
      docxXmlToText(
        '<w:p><w:r><w:t>A</w:t><w:tab/><w:t xml:space="preserve">B &#233;</w:t><w:br/><w:t>C</w:t></w:r></w:p>',
      ),
    ).toBe("A\tB é\nC\n");
  });

  it("refuse un type non pris en charge, un fichier trop gros ou sans texte", async () => {
    const code = (p: Promise<unknown>) => p.then(() => null, importErrorCode);
    expect(
      await code(extractCvText(new TextEncoder().encode("Juste du texte brut ".repeat(10)))),
    ).toBe("cvType");
    expect(await code(extractCvText(makeZip({ "autre.txt": "x" })))).toBe("cvType");
    expect(await code(extractCvText(new Uint8Array(IMPORT_LIMITS.cvMaxBytes + 1)))).toBe(
      "cvTooLarge",
    );
    // PDF scanné : aucune couche texte.
    expect(await code(extractCvText(makePdf([])))).toBe("cvEmpty");
  });

  it("contrôle type et taille dans le navigateur avant l'envoi", () => {
    expect(checkImportFile("cv", { name: "cv.PDF", size: 1000 })).toBeNull();
    expect(checkImportFile("cv", { name: "cv.doc", size: 1000 })).toBe("cvType");
    expect(checkImportFile("cv", { name: "cv.pdf", size: IMPORT_LIMITS.cvMaxBytes + 1 })).toBe(
      "cvTooLarge",
    );
    expect(
      checkImportFile("linkedin", { name: "Basic_LinkedInDataExport.zip", size: 1000 }),
    ).toBeNull();
    expect(checkImportFile("linkedin", { name: "export.rar", size: 10 })).toBe("linkedinInvalid");
  });
});

describe("CSV", () => {
  it("gère guillemets, retours à la ligne et BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","l1\nl2 ""q"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'l1\nl2 "q"'],
    ]);
  });

  it("ignore les notes placées avant l'en-tête", () => {
    expect(csvRecords('Notes:\n"Exporté le…"\n\nName\nSQL\n', "Name")).toEqual([{ Name: "SQL" }]);
  });
});

describe("Export LinkedIn", () => {
  it("lit les dates aux formats LinkedIn", () => {
    expect(parseLinkedInMonth("Jan 2020")).toBe("2020-01");
    expect(parseLinkedInMonth("Sep 2019")).toBe("2019-09");
    expect(parseLinkedInMonth("févr. 2021")).toBe("2021-02");
    expect(parseLinkedInMonth("2018")).toBe("2018-01");
    expect(parseLinkedInMonth("03/2017")).toBe("2017-03");
    expect(parseLinkedInMonth("")).toBeNull();
    expect(parseLinkedInMonth("bientôt")).toBeNull();
  });

  it("ne lit que les CSV utiles (jamais les messages)", () => {
    const data = parseLinkedInExport(
      makeZip({
        "Positions.csv":
          "Company Name,Title,Description,Location,Started On,Finished On\nAcme,Dev,,Paris,Jan 2020,\n",
        "messages.csv": "FROM,CONTENT\nX,secret\n",
        "Skills.csv": "Name\nGo\n",
      }),
    );
    expect(data.positions).toEqual([
      {
        ref: "li-1",
        company: "Acme",
        title: "Dev",
        description: "",
        location: "Paris",
        startMonth: "2020-01",
        endMonth: null,
      },
    ]);
    expect(data.skills).toEqual(["Go"]);
    expect(JSON.stringify(data)).not.toContain("secret");
  });

  it("refuse une archive qui n'est pas un export LinkedIn", () => {
    expect(() => parseLinkedInExport(makeZip({ "photo.txt": "x" }))).toThrow(/linkedinInvalid/);
    expect(() => parseLinkedInExport(makePdf(["x"]))).toThrow(/linkedinInvalid/);
  });

  it("refuse un CSV dont la taille décompressée dépasse la limite (zip bomb)", () => {
    const huge = "Name\n" + "a".repeat(IMPORT_LIMITS.linkedinCsvMaxBytes + 10);
    expect(() => parseLinkedInExport(makeZip({ "Skills.csv": huge }))).toThrow(/linkedinTooLarge/);
  });
});

describe("GitHub", () => {
  it("garde les dépôts originaux, avec langages et extrait du README", async () => {
    const calls: string[] = [];
    const profile = await fetchGithubProfile("@hverdier-dev", { fetch: githubFixtureFetch(calls) });
    expect(profile.profileUrl).toBe("https://github.com/hverdier-dev");
    expect(profile.repos.map((r) => r.name)).toEqual(["jours-feries", "okr-tracker"]);
    expect(profile.repos[0]).toMatchObject({
      url: "https://github.com/hverdier-dev/jours-feries",
      languages: ["TypeScript", "JavaScript"],
      stars: 42,
    });
    expect(profile.repos[0]!.readmeExcerpt).toMatch(/^jours-feries Calcule les jours fériés/);
    expect(profile.repos[0]!.readmeExcerpt).not.toContain("shields.io");
    expect(profile.repos[1]!.readmeExcerpt).toBe("");
    expect(calls.every((url) => url.startsWith("https://api.github.com/"))).toBe(true);
  });

  it("traduit les erreurs en codes", async () => {
    const status = (code: number) => async () => new Response("{}", { status: code });
    const failing = (options: Parameters<typeof fetchGithubProfile>[1]) =>
      fetchGithubProfile("someone", options).then(() => null, importErrorCode);
    expect(await failing({ fetch: status(404) })).toBe("githubNotFound");
    expect(await failing({ fetch: status(403) })).toBe("githubUnavailable");
    expect(
      await failing({
        fetch: async () => {
          throw new Error("réseau");
        },
      }),
    ).toBe("githubUnavailable");
    expect(await fetchGithubProfile("pas un pseudo !").then(() => null, importErrorCode)).toBe(
      "githubInvalid",
    );
  });

  it("nettoie le Markdown du README", () => {
    expect(readmeExcerpt("# Titre\n![badge](x.svg) Voir [la doc](https://x) <b>ici</b>")).toBe(
      "Titre Voir la doc ici",
    );
  });
});

describe("Pseudonymisation", () => {
  it("masque contacts et liens de profil avant l'envoi au modèle", () => {
    const links = createLinkTable();
    const masked = maskContacts(
      "Alex — alex.exemple@mail.test — +33 6 11 22 33 44 — 06.11.22.33.44 — linkedin.com/in/alex-ex — https://github.com/alex-ex — https://github.com/alex-ex/outil. Démo : https://demo.exemple.test/app",
      links,
    );
    expect(masked.text).toBe(
      "Alex — [EMAIL] — [PHONE] — [PHONE] — [PROFILE LINK] — [PROFILE LINK] — [LINK 1]. Démo : [LINK 2]",
    );
    expect(masked.emails).toEqual(["alex.exemple@mail.test"]);
    expect(masked.phones).toEqual(["+33 6 11 22 33 44", "06.11.22.33.44"]);
    expect(masked.identityLinks).toEqual([
      "https://linkedin.com/in/alex-ex",
      "https://github.com/alex-ex",
    ]);
    expect(links.urls).toEqual([
      "https://github.com/alex-ex/outil",
      "https://demo.exemple.test/app",
    ]);
  });

  it("ne confond pas des dates ou montants avec des téléphones", () => {
    const { text } = maskContacts(
      "2018 - 2021, 1 200 000 €, 45 000 €/an, 06/2020",
      createLinkTable(),
    );
    expect(text).toBe("2018 - 2021, 1 200 000 €, 45 000 €/an, 06/2020");
  });

  it("reconnaît les profils personnels", () => {
    expect(isIdentityUrl("https://www.linkedin.com/in/x")).toBe(true);
    expect(isIdentityUrl("https://github.com/x")).toBe(true);
    expect(isIdentityUrl("https://github.com/x/projet")).toBe(false);
    expect(isIdentityUrl("https://exemple.test/portfolio")).toBe(false);
  });

  it("retire les noms sans tenir compte de la casse ni des accents, mots entiers seulement", () => {
    const terms = identityTerms({ people: ["Élodie Marchand"], names: ["Orange SA", "Lumière"] });
    expect(terms).toEqual(
      expect.arrayContaining(["Élodie Marchand", "Élodie", "Marchand", "Orange", "Lumière"]),
    );
    expect(redactTerms("ELODIE a rejoint orange puis LUMIERE.", terms)).toEqual({
      text: "[…] a rejoint […] puis […].",
      changed: true,
    });
    // « Marchandise » contient « Marchand » mais n'est pas le même mot.
    expect(redactTerms("Gestion de la marchandise", terms)).toEqual({
      text: "Gestion de la marchandise",
      changed: false,
    });
  });

  it("retire contacts et repères recopiés par le modèle", () => {
    expect(redactText("Écrire à a.b@c.test ou voir [LINK 2] et [PHONE].", [])).toEqual({
      text: "Écrire à […] ou voir et […].",
      changed: true,
    });
  });
});

describe("Erreurs", () => {
  it("convertit les erreurs IA en codes d'import", () => {
    expect(importErrorCode(new AiError("timeout"))).toBe("aiTimeout");
    expect(importErrorCode(new AiError("notConfigured"))).toBe("aiNotConfigured");
    expect(importErrorCode(new Error("x"))).toBe("unknown");
  });
});

describe("Fichiers sources jamais écrits sur disque", () => {
  it("le code d'import n'utilise pas le système de fichiers", () => {
    const dir = join(process.cwd(), "src/lib/import");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(
        /from "(node:)?fs(\/promises)?"|career\/storage|writeFile|tmpdir/,
      );
    }
  });
});
