/**
 * `npm run ai:eval` — passe les fixtures FICTIVES de l'import IA
 * (`tests/fixtures/import`) au VRAI fournisseur configuré (`AI_PROVIDER`,
 * `MISTRAL_API_KEY`… dans `.env`) et compare le résultat à l'attendu.
 * Évaluation manuelle, pour comparer prompts et modèles ; jamais lancé en CI.
 *
 *   npm run ai:eval                          # tous les cas
 *   npm run ai:eval -- cv-en-product-designer
 *
 * GitHub n'est pas appelé (réponses enregistrées). Code de sortie 1 si une
 * donnée identifiante fuit dans un brouillon.
 */
import "dotenv/config";
import { aiClientFromEnv } from "../src/lib/ai/config";
import { skillKey } from "../src/lib/career/derive";
import { importErrorCode } from "../src/lib/import/errors";
import { runImport } from "../src/lib/import/pipeline";
import type { ImportResult } from "../src/lib/import/shared";
import { IMPORT_CASES } from "../tests/fixtures/import/cases";

const pct = (value: number) => `${Math.round(value * 100)} %`;

function texts(result: ImportResult): string {
  const { draft, flags } = result;
  return [
    ...draft.experiences.flatMap((e) => [e.roleTitle, e.responsibilities]),
    ...draft.achievements.flatMap((a) => [a.title, a.context, a.actions, a.result, ...a.skills]),
    ...draft.skills,
    ...[...flags.experiences, ...flags.achievements].flatMap((f) => f.rareDetails),
  ]
    .join("\n")
    .toLowerCase();
}

function allSkills(result: ImportResult): Set<string> {
  return new Set(
    [...result.draft.skills, ...result.draft.achievements.flatMap((a) => a.skills)].map(skillKey),
  );
}

async function main(): Promise<number> {
  const only = process.argv.slice(2);
  const cases = IMPORT_CASES.filter((c) => !only.length || only.includes(c.id));
  const ai = aiClientFromEnv();
  console.log(`Fournisseur : ${ai.provider.name} (${ai.provider.chatModel})\n`);
  let leaks = 0;
  const rows = [];
  for (const fixture of cases) {
    const started = Date.now();
    try {
      const got = await runImport(fixture.sources(), {
        ai,
        locale: fixture.locale,
        githubFetch: fixture.githubFetch,
      });
      const expected = fixture.expected();
      const serialized = JSON.stringify(got.draft).toLowerCase();
      const body = texts(got);
      const leaked = [
        ...fixture.forbidden.filter((v) => serialized.includes(v.toLowerCase())),
        ...fixture.forbiddenInText.filter((v) => body.includes(v.toLowerCase())),
      ];
      leaks += leaked.length;
      // Expériences appariées sur le mois de début.
      const byStart = new Map(got.draft.experiences.map((e) => [e.startMonth, e]));
      const matched = expected.draft.experiences.filter((e) => byStart.has(e.startMonth));
      const codesOk = matched.filter((e) => {
        const g = byStart.get(e.startMonth)!;
        return (
          g.sector === e.sector && g.companySize === e.companySize && g.endMonth === e.endMonth
        );
      }).length;
      const wanted = allSkills(expected);
      const found = allSkills(got);
      const recall = [...wanted].filter((s) => found.has(s)).length / Math.max(1, wanted.size);
      rows.push({
        cas: fixture.id,
        "durée (s)": Math.round((Date.now() - started) / 100) / 10,
        expériences: `${got.draft.experiences.length}/${expected.draft.experiences.length}`,
        "dates ok": `${matched.length}/${expected.draft.experiences.length}`,
        "codes ok": `${codesOk}/${matched.length}`,
        réalisations: `${got.draft.achievements.length}/${expected.draft.achievements.length}`,
        preuves: got.draft.achievements.filter((a) => a.proofs.length).length,
        "rappel compétences": pct(recall),
        "employeurs repérés": `${got.identity.employers.length}/${expected.identity.employers.length}`,
        fuites: leaked.length ? leaked.join(", ") : "aucune",
      });
    } catch (error) {
      rows.push({ cas: fixture.id, erreur: importErrorCode(error) });
    }
  }
  console.table(rows);
  return leaks > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : "Erreur");
    process.exit(1);
  },
);
