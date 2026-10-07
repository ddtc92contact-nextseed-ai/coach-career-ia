import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppLocale } from "../../../src/i18n/routing";
import type { ImportSources } from "../../../src/lib/import/pipeline";
import type { ImportResult } from "../../../src/lib/import/shared";
import { makeDocx, makePdf, makeZip } from "../../helpers/documents";

/**
 * Jeu de référence de l'import IA : profils FICTIFS (aucune donnée réelle),
 * avec la réponse simulée du modèle (`*.llm.json`) et le résultat attendu
 * (`*.expected.json`). Utilisé par `tests/unit/import-pipeline.test.ts` (simulateur)
 * et par `npm run ai:eval` (vrai fournisseur, évaluation manuelle).
 */

const DIR = join(process.cwd(), "tests/fixtures/import");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const lines = (name: string) => read(name).trimEnd().split("\n");

export type ImportCase = {
  id: string;
  description: string;
  locale: AppLocale;
  sources: () => ImportSources;
  githubFetch?: (url: string) => Promise<Response>;
  /** Chaînes identifiantes qui ne doivent apparaître NULLE PART dans le brouillon. */
  forbidden: string[];
  /** Parties de noms, interdites dans les textes (les URL de dépôts peuvent contenir le pseudo). */
  forbiddenInText: string[];
  /** Retirés AVANT l'appel au modèle (contacts, liens de profil, données LinkedIn inutiles). */
  notSentToModel: string[];
  llmReply: () => string;
  expected: () => ImportResult;
};

function linkedinZip(): Uint8Array {
  const files: Record<string, string> = {};
  for (const name of readdirSync(join(DIR, "linkedin"))) {
    files[name] = read(join("linkedin", name));
  }
  return makeZip(files);
}

/** API GitHub simulée à partir de `github/` (aucun accès réseau). */
export function githubFixtureFetch(calls: string[] = []) {
  return async (url: string): Promise<Response> => {
    calls.push(url);
    const json = (body: string, status = 200) =>
      new Response(body, { status, headers: { "content-type": "application/json" } });
    const path = new URL(url).pathname;
    if (path === "/users/hverdier-dev/repos") return json(read("github/repos.json"));
    const match = /^\/repos\/hverdier-dev\/([^/]+)\/(languages|readme)$/.exec(path);
    if (match) {
      const [, repo, kind] = match;
      try {
        return kind === "languages"
          ? json(read(`github/${repo}.languages.json`))
          : new Response(read(`github/${repo}.README.md`));
      } catch {
        return json('{"message":"Not Found"}', 404);
      }
    }
    return json('{"message":"Not Found"}', 404);
  };
}

const fixture = (id: string) => ({
  llmReply: () => read(`${id}.llm.json`),
  expected: () => JSON.parse(read(`${id}.expected.json`)) as ImportResult,
});

export const IMPORT_CASES: ImportCase[] = [
  {
    id: "cv-fr-data-engineer",
    description: "CV français (DOCX), data engineer, 3 postes dont un stage",
    locale: "fr",
    sources: () => ({ cv: makeDocx(lines("cv-fr-data-engineer.txt")) }),
    forbidden: [
      "Camille Rousset",
      "camille.rousset@exemple.test",
      "06 12 34 56 78",
      "camille-rousset-exemple",
      "crousset-data",
      "Banque Lumière",
      "Trajecto",
      "Groupe Hexadis",
      "Hexadis",
      "École Nationale des Données de Brest",
    ],
    forbiddenInText: ["Camille", "Rousset", "Brest"],
    notSentToModel: [
      "camille.rousset@exemple.test",
      "06 12 34 56 78",
      "camille-rousset-exemple",
      "crousset-data",
    ],
    ...fixture("cv-fr-data-engineer"),
  },
  {
    id: "cv-en-product-designer",
    description: "CV anglais (PDF), designer produit, brouillon rédigé en français",
    locale: "fr",
    sources: () => ({ cv: makePdf(lines("cv-en-product-designer.txt")) }),
    forbidden: [
      "Oliver Brandt",
      "OLIVER BRANDT",
      "oliver.brandt@example.test",
      "+44 7700 900123",
      "obrandt-example",
      "Pixelfjord",
      "Northwind Health",
      "Northwind",
      "Kingsbridge School of Art",
    ],
    forbiddenInText: ["Oliver", "Brandt", "Kingsbridge"],
    notSentToModel: ["oliver.brandt@example.test", "+44 7700 900123", "obrandt-example"],
    ...fixture("cv-en-product-designer"),
  },
  {
    id: "cv-de-devops",
    description: "CV allemand (PDF), DevOps, brouillon rédigé en allemand, codes à corriger",
    locale: "de",
    sources: () => ({ cv: makePdf(lines("cv-de-devops.txt")) }),
    forbidden: [
      "Lena Hartmann",
      "lena.hartmann@beispiel.test",
      "+49 170 1234567",
      "Wolkenbau",
      "Stahlwerk Rheinau",
      "Hochschule Neustadt",
    ],
    forbiddenInText: ["Lena", "Hartmann", "Rheinau", "Neustadt"],
    notSentToModel: ["lena.hartmann@beispiel.test", "+49 170 1234567"],
    ...fixture("cv-de-devops"),
  },
  {
    id: "linkedin-github-pm",
    description: "Export LinkedIn (ZIP) + GitHub public, product manager",
    locale: "fr",
    sources: () => ({ linkedin: linkedinZip(), github: "hverdier-dev" }),
    githubFetch: githubFixtureFetch(),
    forbidden: [
      "Hugo Verdier",
      "hugo.verdier@exemple.test",
      "+33 6 98 76 54 32",
      "12 rue des Lilas",
      "hugoverdier.example.test",
      "Payflow",
      "Atelier Numérique",
      "Grand Magasin du Centre",
      "Fonderies du Rhône",
      "Université de Valcourt",
      "Message privé",
    ],
    forbiddenInText: ["Hugo", "Verdier", "hverdier", "Valcourt"],
    notSentToModel: [
      "Hugo",
      "hugo.verdier@exemple.test",
      "+33 6 98 76 54 32",
      "12 rue des Lilas",
      "hugoverdier.example.test",
      "hverdier-dev",
      "Message privé",
    ],
    ...fixture("linkedin-github-pm"),
  },
];
