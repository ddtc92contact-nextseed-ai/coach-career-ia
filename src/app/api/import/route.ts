import { getAiClient, isAiConfigured } from "@/lib/ai/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserLocale } from "@/lib/i18n/user-locale";
import { importErrorCode, ImportError } from "@/lib/import/errors";
import { runImport } from "@/lib/import/pipeline";
import { createRateLimiter } from "@/lib/import/rate-limit";
import { IMPORT_LIMITS, type ImportErrorCode, type ImportResponse } from "@/lib/import/shared";
import { logger } from "@/lib/logger";

/**
 * Import IA d'un parcours (formulaire multipart : `cv`, `linkedin`, `github`).
 *
 * Les fichiers sont lus en mémoire puis abandonnés : rien n'est écrit sur
 * disque ni en base. La réponse (brouillon + identité) n'est destinée qu'au
 * navigateur du candidat et n'est pas mise en cache. Le journal ne contient
 * que des compteurs et des codes d'erreur.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const limiter = createRateLimiter({ max: IMPORT_LIMITS.importsPerHour, windowMs: 3_600_000 });
/** Corps maximal accepté : les deux fichiers + marge pour l'enveloppe multipart. */
const MAX_BODY_BYTES = IMPORT_LIMITS.cvMaxBytes + IMPORT_LIMITS.linkedinMaxBytes + 512 * 1024;

const STATUS: Partial<Record<ImportErrorCode, number>> = {
  unauthorized: 401,
  cvTooLarge: 413,
  linkedinTooLarge: 413,
  tooManyImports: 429,
  aiRateLimited: 503,
  aiNotConfigured: 503,
  aiUnavailable: 503,
  aiTimeout: 504,
  aiInvalidOutput: 502,
  githubUnavailable: 502,
  unknown: 500,
};

function reply(body: ImportResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function fail(code: ImportErrorCode) {
  return reply({ ok: false, error: code }, STATUS[code] ?? 400);
}

/** Contenu d'un champ fichier, après contrôle de sa taille. */
async function fileField(
  form: FormData,
  name: string,
  maxBytes: number,
  tooLarge: ImportErrorCode,
) {
  const value = form.get(name);
  if (!(value instanceof File) || value.size === 0) return undefined;
  if (value.size > maxBytes) throw new ImportError(tooLarge);
  return new Uint8Array(await value.arrayBuffer());
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("unauthorized");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail("linkedinTooLarge");
  }
  if (!isAiConfigured()) return fail("aiNotConfigured");
  if (!limiter.take(user.id)) return fail("tooManyImports");

  const started = Date.now();
  try {
    const form = await request.formData().catch(() => {
      throw new ImportError("noSource");
    });
    const cv = await fileField(form, "cv", IMPORT_LIMITS.cvMaxBytes, "cvTooLarge");
    const linkedin = await fileField(
      form,
      "linkedin",
      IMPORT_LIMITS.linkedinMaxBytes,
      "linkedinTooLarge",
    );
    const github = String(form.get("github") ?? "").trim() || undefined;

    const result = await runImport(
      { cv, linkedin, github },
      {
        ai: getAiClient(),
        locale: await getUserLocale(user.id),
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(IMPORT_LIMITS.serverBudgetMs),
        ]),
        githubToken: process.env.GITHUB_TOKEN || undefined,
      },
    );
    logger.info("import.draft", {
      userId: user.id,
      cv: result.sources.cv,
      linkedin: result.sources.linkedin,
      github: result.sources.github,
      experiences: result.draft.experiences.length,
      achievements: result.draft.achievements.length,
      skills: result.draft.skills.length,
      durationMs: Date.now() - started,
    });
    return reply({ ok: true, result });
  } catch (error) {
    const code = importErrorCode(error);
    // Jamais l'erreur brute : elle pourrait citer un extrait du document.
    logger.warn("import.failed", { userId: user.id, code, durationMs: Date.now() - started });
    return fail(code);
  }
}
