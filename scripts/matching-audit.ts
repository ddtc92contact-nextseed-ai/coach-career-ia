/**
 * `npm run matching:audit -- <candidateId|email> [--json] [--top N] [--model M]`
 * — audit du classement d'un candidat (issue #78), à lancer après chaque
 * déploiement du matching. LECTURE SEULE : session PostgreSQL
 * `default_transaction_read_only=on`, vérifiée avant toute lecture (chaque
 * transaction est `READ ONLY`, toute écriture serait refusée), aucun appel
 * au fournisseur d'IA. Le score est rejoué avec les fonctions de `score.ts`
 * sur les offres et embeddings déjà en base (`DATABASE_URL`).
 *
 * La sortie ne contient aucune donnée identifiante du candidat (ni nom, ni
 * contact, ni employeur, ni texte de réalisation) : seulement des
 * identifiants, des empreintes et des nombres. Voir `src/lib/matching/README.md`.
 *
 * Code de sortie : 0 (rapport), 1 (erreur), 2 (candidat introuvable ou usage).
 */
import "dotenv/config";
import {
  AUDIT_TOP,
  CandidateNotFound,
  formatAudit,
  runReadOnlyAudit,
  toJson,
} from "../src/lib/matching/audit";

const USAGE =
  "Usage : npm run matching:audit -- <candidateId|email> [--json] [--top N] [--model M]";

function parseArgs(argv: string[]) {
  let identifier: string | undefined;
  let json = false;
  let top = AUDIT_TOP;
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--top") top = Number(argv[++i]);
    else if (arg === "--model") model = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`option inconnue : ${arg}`);
    else if (!identifier) identifier = arg;
    else throw new Error("un seul candidat à la fois");
  }
  if (!identifier) throw new Error("candidat manquant");
  if (!Number.isInteger(top) || top < 1 || top > 500) throw new Error("--top invalide");
  if (model !== undefined && !model) throw new Error("--model invalide");
  return { identifier, json, top, model };
}

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}\n${USAGE}`);
    return 2;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");
  try {
    const report = await runReadOnlyAudit(connectionString, args.identifier, {
      top: args.top,
      model: args.model,
    });
    process.stdout.write(args.json ? toJson(report) : formatAudit(report));
    return 0;
  } catch (error) {
    if (error instanceof CandidateNotFound) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec de l'audit :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
