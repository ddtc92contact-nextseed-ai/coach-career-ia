/**
 * `npm run radar:companies-check -- [candidats.json] [options]` — vérifie des
 * boards ATS candidats pour la liste de référence du radar. Lancé à la main,
 * jamais en CI (requêtes réelles vers les ATS).
 *
 * Chaque candidat (`name`, `ats`, `boardToken`, `sector`, `website`…) est
 * interrogé une fois via l'API publique de son board, avec le client HTTP du
 * radar : User-Agent avec contact (`RADAR_CONTACT`), robots.txt, débit par
 * hôte (`RADAR_MIN_INTERVAL_MS`). Verdict : valide, jeton inconnu, aucune
 * offre en France / UE, nom différent, injoignable.
 *
 * Sans fichier, revérifie `config/radar-companies.json`.
 *   --report <fichier.json>   rapport détaillé (une ligne par candidat)
 *   --markdown <fichier.md>   résumé par ATS (à joindre à la PR)
 *   --write                   ajoute les candidats valides à la liste de référence
 *   --concurrency <n>         candidats vérifiés en parallèle (défaut 4)
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import {
  candidateSchema,
  checkCandidates,
  mergeAccepted,
  summarizeChecks,
  type CheckResult,
  type CheckStatus,
} from "../src/lib/radar/companies-check";
import { loadCompanyConfig } from "../src/lib/radar/companies";
import { RADAR_PRODUCT } from "../src/lib/radar/config";
import { radarHttpClient } from "../src/lib/radar/job";

const CONFIG = process.env.RADAR_COMPANIES_FILE || "config/radar-companies.json";

const LABELS: Record<CheckStatus, string> = {
  valid: "valide",
  unknownToken: "jeton inconnu",
  noEuOffers: "0 offre FR/UE",
  nameMismatch: "autre entreprise",
  unreachable: "injoignable",
};

function args(argv: string[]) {
  const options = {
    input: CONFIG,
    report: null as string | null,
    markdown: null as string | null,
    write: false,
    concurrency: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--report") options.report = argv[++i] ?? null;
    else if (arg === "--markdown") options.markdown = argv[++i] ?? null;
    else if (arg === "--write") options.write = true;
    else if (arg === "--concurrency") options.concurrency = Number(argv[++i]) || 4;
    else if (!arg.startsWith("--")) options.input = arg;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

function markdown(results: CheckResult[]): string {
  const summary = summarizeChecks(results);
  const statuses = Object.keys(LABELS) as CheckStatus[];
  const rows = Object.entries(summary).filter(([, s]) => s.total > 0);
  const total = (status: CheckStatus | "total") => rows.reduce((n, [, s]) => n + s[status], 0);
  const lines = [
    `| ATS | Candidats | ${statuses.map((s) => LABELS[s]).join(" | ")} |`,
    `| --- | ---: | ${statuses.map(() => "---:").join(" | ")} |`,
    ...rows.map(
      ([ats, s]) => `| ${ats} | ${s.total} | ${statuses.map((st) => s[st]).join(" | ")} |`,
    ),
    `| **Total** | **${total("total")}** | ${statuses.map((s) => `**${total(s)}**`).join(" | ")} |`,
  ];
  const valid = results.filter((r) => r.status === "valid");
  lines.push(
    "",
    `Valides : ${valid.length} boards, ${valid.reduce((n, r) => n + r.fr, 0)} offres en France ` +
      `et ${valid.reduce((n, r) => n + r.eu, 0)} dans l'UE ; ` +
      `${valid.filter((r) => r.fr > 0).length} boards avec au moins une offre en France.`,
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<number> {
  const options = args(process.argv.slice(2));
  const contact = process.env.RADAR_CONTACT?.trim();
  if (!contact) throw new Error("RADAR_CONTACT (URL ou e-mail du User-Agent) est requis");
  const minIntervalMs = Math.max(250, Number(process.env.RADAR_MIN_INTERVAL_MS) || 1000);
  const http = radarHttpClient({ userAgent: `${RADAR_PRODUCT} (+${contact})`, minIntervalMs });

  const parsed = candidateSchema.safeParse(JSON.parse(await readFile(options.input, "utf8")));
  if (!parsed.success) throw new Error(`Candidats invalides : ${parsed.error.message}`);
  const candidates = parsed.data;
  console.log(`${candidates.length} candidats à vérifier (${options.input}).`);

  const results = await checkCandidates(http, candidates, {
    concurrency: options.concurrency,
    onResult: (r, done) =>
      console.log(
        `[${done}/${candidates.length}] ${r.candidate.ats}:${r.candidate.boardToken} — ` +
          `${LABELS[r.status]} (${r.offers} offres, FR ${r.fr}, UE ${r.eu}` +
          `${r.atsName ? `, ATS « ${r.atsName} »` : ""}${r.error ? `, ${r.error}` : ""})`,
      ),
  });

  const report = markdown(results);
  console.log(`\n${report}`);
  if (options.report) {
    await writeFile(
      options.report,
      `${JSON.stringify(
        results.map(({ candidate, ...r }) => ({
          name: candidate.name,
          ats: candidate.ats,
          boardToken: candidate.boardToken,
          ...r,
        })),
        null,
        2,
      )}\n`,
    );
  }
  if (options.markdown) await writeFile(options.markdown, report);
  if (options.write) {
    const existing = await loadCompanyConfig(CONFIG);
    const { config, added } = mergeAccepted(existing, results);
    // `active` n'est écrit que s'il vaut `false` (valeur par défaut : `true`).
    const entries = config.map(({ active, ...c }) => (active ? c : { ...c, active }));
    await writeFile(CONFIG, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`${added} entreprises ajoutées à ${CONFIG} (${config.length} au total).`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec de la vérification :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
