import type { AiClient } from "@/lib/ai/client";
import type { AppLocale } from "@/i18n/routing";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";
import { skillKey } from "@/lib/career/derive";
import { CareerMemoryDraft, currentMonth, ImportedDraft, LIMITS } from "@/lib/career/schemas";
import { truncateSafe } from "@/lib/text/truncate";
import { checkCoverage } from "./coverage";
import { ImportError } from "./errors";
import { extractCvText, normalizeText } from "./extract";
import { fetchGithubProfile, type GithubFetch, type GithubProfile } from "./github";
import { parseLinkedInExport, type LinkedInExport } from "./linkedin";
import {
  buildExtractionMessages,
  EXTRACTION_JSON_SCHEMA,
  ExtractionSchema,
  type Extraction,
} from "./prompt";
import {
  createLinkTable,
  identityTerms,
  isIdentityUrl,
  type LinkTable,
  maskContacts,
  REDACTION,
  redactText,
  resolveLinkToken,
} from "./pseudonymise";
import {
  type DateAdjustment,
  type DateIssue,
  type DropReason,
  IMPORT_LIMITS,
  type IdentityPayload,
  type ImportReport,
  type ImportResult,
  type ItemFlags,
} from "./shared";

/**
 * Import d'un parcours : CV, export LinkedIn et/ou GitHub → brouillon
 * pseudonymisé de mémoire de carrière + données identifiantes à part.
 *
 * Tout se passe en mémoire : aucun fichier source n'est écrit ni conservé.
 * Le brouillon n'est PAS enregistré : le candidat valide chaque élément.
 */

export type ImportSources = {
  cv?: Uint8Array;
  linkedin?: Uint8Array;
  github?: string;
};

export type ImportOptions = {
  ai: AiClient;
  locale: AppLocale;
  signal?: AbortSignal;
  githubFetch?: GithubFetch;
  githubToken?: string;
};

// --- Préparation des sources (règles, sans modèle) --------------------------------

function linkedInText(data: LinkedInExport, links: LinkTable): string {
  const lines: string[] = [];
  if (data.headline) lines.push(`Headline: ${data.headline}`);
  if (data.summary) lines.push(`Summary: ${data.summary}`);
  if (data.positions.length) {
    lines.push("", "### Positions");
    for (const p of data.positions) {
      lines.push(
        `[${p.ref}] ${p.title} | employer: ${p.company} | ${p.location} | from ${p.startMonth ?? "?"} to ${p.endMonth ?? "present"}`,
      );
      if (p.description) lines.push(`  ${p.description.replace(/\s*\n\s*/g, " ")}`);
    }
  }
  if (data.education.length) {
    lines.push("", "### Education (context only, not jobs)");
    for (const e of data.education) {
      lines.push(
        `- ${e.degree} | school: ${e.school} | ${e.startYear}-${e.endYear} ${e.notes}`.trim(),
      );
    }
  }
  if (data.projects.length) {
    lines.push("", "### Projects");
    for (const p of data.projects) {
      const link = p.url ? ` ${links.add(p.url)}` : "";
      lines.push(`- ${p.title}${link} (${p.startMonth ?? "?"}): ${p.description}`);
    }
  }
  if (data.certifications.length) {
    lines.push("", "### Certifications");
    for (const c of data.certifications) {
      const link = c.url ? ` ${links.add(c.url)}` : "";
      lines.push(`- ${c.name} (${c.authority}, ${c.startMonth ?? "?"})${link}`);
    }
  }
  if (data.skills.length) lines.push("", `### Skills\n${data.skills.join(", ")}`);
  return normalizeText(maskContacts(lines.join("\n"), links).text, IMPORT_LIMITS.linkedinMaxChars);
}

function githubText(profile: GithubProfile, links: LinkTable): string {
  const lines = profile.repos.map((repo) => {
    const meta = [
      repo.languages.length ? `languages: ${repo.languages.join(", ")}` : null,
      `stars: ${repo.stars}`,
      repo.pushedAt ? `last push: ${repo.pushedAt.slice(0, 7)}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return [
      `- ${links.add(repo.url)} ${repo.name}: ${repo.description} (${meta})`,
      repo.readmeExcerpt ? `  README: ${repo.readmeExcerpt}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return normalizeText(maskContacts(lines.join("\n"), links).text, IMPORT_LIMITS.githubMaxChars);
}

// --- Normalisation de la réponse du modèle -----------------------------------------

/** Titre de repli quand tout le texte était identifiant. */
const REDACTED_TITLE = REDACTION;

function pickCode<T extends string>(
  codes: readonly T[],
  value: string,
  fallback: T,
): { value: T; adjusted: boolean } {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const found = codes.find((code) => code === normalized);
  return found ? { value: found, adjusted: false } : { value: fallback, adjusted: true };
}

type MonthValue = { month: string | null; yearOnly: boolean };

/** Avant cette année, une date lue est jugée illisible (à compléter). */
const MIN_YEAR = 1950;

/** `AAAA-MM`, ou `AAAA` seul (mois inconnu : janvier, à faire compléter). */
function toMonth(value: string | null | undefined): MonthValue {
  const match = value ? /^(\d{4})(?:-(\d{1,2}))?/.exec(value.trim()) : null;
  if (!match || Number(match[1]) < MIN_YEAR) return { month: null, yearOnly: false };
  const month = Number(match[2] ?? 1);
  if (month < 1 || month > 12) return { month: null, yearOnly: false };
  return { month: `${match[1]}-${String(month).padStart(2, "0")}`, yearOnly: !match[2] };
}

function clip(text: string, max: number): { text: string; adjusted: boolean } {
  const trimmed = text.trim();
  return trimmed.length > max
    ? { text: `${truncateSafe(trimmed, max - 1).trimEnd()}…`, adjusted: true }
    : { text: trimmed, adjusted: false };
}

const newFlags = (): ItemFlags => ({
  identityRemoved: false,
  identifyingLink: false,
  adjusted: false,
  rareDetails: [],
  dateIssues: [],
});

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type BuildContext = {
  linkedin: LinkedInExport | null;
  github: GithubProfile | null;
  links: LinkTable;
  contacts: { emails: string[]; phones: string[]; identityLinks: string[] };
  /** Texte du CV (contacts masqués) : contrôle de couverture des années. */
  cvText?: string;
};

/** Brouillon validé + signalements + identité, à partir de la réponse du modèle. */
export function buildResult(extraction: Extraction, context: BuildContext): ImportResult {
  const { linkedin, github, links } = context;
  const now = currentMonth();
  const positions = new Map(linkedin?.positions.map((p) => [p.ref, p]) ?? []);

  // Identité : règles (LinkedIn, contacts masqués) + noms repérés par le modèle.
  const linkedinName = linkedin ? `${linkedin.firstName} ${linkedin.lastName}`.trim() : "";
  const fullName = linkedinName || extraction.identity.fullName?.trim() || null;
  const people = uniqueBy(
    [fullName, extraction.identity.fullName, linkedin?.firstName, linkedin?.lastName].filter(
      (v): v is string => !!v?.trim(),
    ),
    (v) => v.toLowerCase(),
  );
  const employers = uniqueBy(
    [
      ...extraction.experiences
        .filter((e) => e.employerName?.trim())
        .map((e) => ({ name: e.employerName!.trim(), experienceRef: e.ref })),
      ...(linkedin?.positions ?? [])
        .filter((p) => p.company)
        .map((p) => ({ name: p.company, experienceRef: p.ref })),
    ],
    (e) => `${e.name.toLowerCase()}|${e.experienceRef}`,
  );
  const schools = uniqueBy(
    [
      ...extraction.identity.schools.map((s) => ({
        name: s.name.trim(),
        degree: s.degree?.trim() || null,
      })),
      ...(linkedin?.education ?? []).map((e) => ({ name: e.school, degree: e.degree || null })),
    ],
    (s) => s.name.toLowerCase(),
  );
  const organizations = uniqueBy(
    extraction.identity.organizations.map((o) => o.trim()),
    (o) => o.toLowerCase(),
  );
  const identity: IdentityPayload = {
    fullName,
    emails: uniqueBy([...context.contacts.emails, ...(linkedin?.emails ?? [])], (v) =>
      v.toLowerCase(),
    ),
    phones: uniqueBy([...context.contacts.phones, ...(linkedin?.phones ?? [])], (v) =>
      v.replace(/\D/g, ""),
    ),
    links: uniqueBy(
      [
        ...context.contacts.identityLinks,
        ...(linkedin?.websites ?? []),
        ...(github ? [github.profileUrl] : []),
      ],
      (v) => v.toLowerCase(),
    ),
    employers,
    schools,
    organizations,
  };
  const terms = identityTerms({
    people,
    names: [
      ...employers.map((e) => e.name),
      ...schools.map((s) => s.name),
      ...organizations,
      ...identity.emails,
      ...(github ? [github.username] : []),
    ],
  });
  const redact = (text: string, flags: ItemFlags) => {
    const result = redactText(text, terms);
    if (result.changed) flags.identityRemoved = true;
    return result.text;
  };
  /** Compétences : celles qui étaient un nom (employeur, pseudo…) sont retirées. */
  const redactList = (values: string[], flags: ItemFlags) =>
    values.map((v) => redact(v, flags)).filter((v) => v && !v.includes(REDACTION));
  const redactDetails = (values: string[], flags: ItemFlags) =>
    values
      .map((v) => clip(redact(v, flags), 300).text)
      .filter(Boolean)
      .slice(0, 5);

  // Bilan : chaque élément extrait est gardé (éventuellement signalé) ou compté
  // dans `dropped`, jamais abandonné en silence.
  const report: ImportReport = {
    experiences: {
      extracted: extraction.experiences.length,
      kept: 0,
      flagged: 0,
      dropped: 0,
      reasons: {},
    },
    achievements: { extracted: extraction.achievements.length, kept: 0, dropped: 0 },
    dropped: [],
    coverage: null,
  };
  const reasons = report.experiences.reasons;
  const count = (reason: DateIssue | DateAdjustment | DropReason) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };
  const drop = (kind: "experience" | "achievement", title: string, reason: DropReason) => {
    report.dropped.push({ kind, title: title || REDACTED_TITLE, reason });
    if (kind === "experience") {
      report.experiences.dropped += 1;
      count(reason);
    } else {
      report.achievements.dropped += 1;
    }
  };

  // Expériences.
  const experiences: ImportedDraft["experiences"] = [];
  const experienceFlags: ItemFlags[] = [];
  const refs = new Set<string>();
  /** Réf. libre quand celle du modèle manque ou est déjà prise. */
  const freeRef = (base: string) => {
    const prefix = base.slice(0, 56) || "exp";
    let n = 2;
    while (refs.has(`${prefix}-${n}`)) n += 1;
    return `${prefix}-${n}`;
  };
  for (const raw of extraction.experiences) {
    const flags = newFlags();
    const roleTitle = clip(redact(raw.roleTitle, flags), LIMITS.roleTitle);
    if (experiences.length >= LIMITS.draftExperiences) {
      drop("experience", roleTitle.text, "tooMany");
      continue;
    }
    const modelRef = raw.ref.trim().slice(0, 64);
    let ref = modelRef;
    if (!ref || refs.has(ref)) {
      ref = freeRef(ref);
      count("refRenamed");
    }
    const position = positions.get(modelRef);
    // Les dates de LinkedIn (structurées) priment sur celles du modèle.
    const start = position?.startMonth
      ? { month: position.startMonth, yearOnly: false }
      : toMonth(raw.startMonth);
    const end = position ? { month: position.endMonth, yearOnly: false } : toMonth(raw.endMonth);
    let startMonth = start.month;
    let endMonth = end.month;
    let [startYearOnly, endYearOnly] = [start.yearOnly, end.yearOnly];
    if (endMonth && endMonth > now) {
      endMonth = null;
      endYearOnly = false;
      flags.adjusted = true;
      count("endInFuture");
    }
    if (startMonth && endMonth && endMonth < startMonth && startMonth <= now) {
      [startMonth, endMonth] = [endMonth, startMonth];
      [startYearOnly, endYearOnly] = [endYearOnly, startYearOnly];
      flags.adjusted = true;
      count("endBeforeStart");
    }
    // Dates absentes, partielles ou incohérentes : l'expérience reste, à compléter.
    if (!startMonth) flags.dateIssues.push("startMissing");
    else if (startMonth > now) flags.dateIssues.push("startInFuture");
    else if (startYearOnly) flags.dateIssues.push("startYearOnly");
    if (endMonth && endYearOnly) flags.dateIssues.push("endYearOnly");

    const codes = {
      seniority: pickCode(SENIORITIES, raw.seniority, "MID"),
      contractType: pickCode(CONTRACT_TYPES, raw.contractType, "CDI"),
      sector: pickCode(SECTORS, raw.sector, "OTHER"),
      companySize: pickCode(COMPANY_SIZES, raw.companySize, "S51_200"),
      companyStage: pickCode(COMPANY_STAGES, raw.companyStage, "SME"),
    };
    if (Object.values(codes).some((c) => c.adjusted)) flags.adjusted = true;
    const responsibilities = clip(redact(raw.responsibilities, flags), LIMITS.responsibilities);
    if (roleTitle.adjusted || responsibilities.adjusted) flags.adjusted = true;
    flags.rareDetails = redactDetails(raw.rareDetails, flags);

    const parsed = ImportedDraft.shape.experiences.element.safeParse({
      ref,
      roleTitle: roleTitle.text || REDACTED_TITLE,
      startMonth: startMonth ?? "",
      endMonth: endMonth ?? undefined,
      seniority: codes.seniority.value,
      contractType: codes.contractType.value,
      sector: codes.sector.value,
      companySize: codes.companySize.value,
      companyStage: codes.companyStage.value,
      responsibilities: responsibilities.text,
    });
    if (!parsed.success) {
      drop("experience", roleTitle.text, "invalid");
      continue;
    }
    refs.add(ref);
    experiences.push(parsed.data);
    experienceFlags.push(flags);
    report.experiences.kept += 1;
    if (flags.dateIssues.length) report.experiences.flagged += 1;
    flags.dateIssues.forEach(count);
  }

  // Réalisations.
  const achievements: CareerMemoryDraft["achievements"] = [];
  const achievementFlags: ItemFlags[] = [];
  const identityUrls = new Set(identity.links.map((l) => l.toLowerCase()));
  const githubPrefix = github ? `https://github.com/${github.username.toLowerCase()}/` : null;
  for (const raw of extraction.achievements) {
    const flags = newFlags();
    const title = clip(redact(raw.title, flags), LIMITS.achievementTitle);
    if (achievements.length >= LIMITS.draftAchievements) {
      drop("achievement", title.text, "tooMany");
      continue;
    }
    const context = clip(redact(raw.context, flags), LIMITS.context);
    const actions = clip(redact(raw.actions, flags) || redact(raw.title, flags), LIMITS.actions);
    const result = clip(redact(raw.result, flags), LIMITS.result);
    if ([title, context, actions, result].some((f) => f.adjusted)) flags.adjusted = true;
    const skills = uniqueBy(redactList(raw.skills, flags), skillKey)
      .map((s) => truncateSafe(s, LIMITS.skillName))
      .slice(0, LIMITS.skillsPerAchievement);
    const urls = uniqueBy(
      raw.links
        .map((token) => resolveLinkToken(token, links))
        .filter(
          (url): url is string =>
            !!url && !isIdentityUrl(url) && !identityUrls.has(url.toLowerCase()),
        ),
      (url) => url.toLowerCase(),
    ).slice(0, 10);
    if (githubPrefix && urls.some((url) => url.toLowerCase().startsWith(githubPrefix))) {
      flags.identifyingLink = true;
    }
    flags.rareDetails = redactDetails(raw.rareDetails, flags);
    const experienceRef = raw.experienceRef?.trim() || undefined;
    // Lien vers une expérience inconnue (ou écartée) : la réalisation reste, sans lien.
    if (experienceRef && !refs.has(experienceRef)) flags.adjusted = true;

    const parsed = CareerMemoryDraft.shape.achievements.element.safeParse({
      title: title.text || REDACTED_TITLE,
      context: context.text,
      actions: actions.text,
      result: result.text,
      skills,
      experienceRef: experienceRef && refs.has(experienceRef) ? experienceRef : undefined,
      proofs: urls.map((url) => ({ kind: "URL", url })),
    });
    if (!parsed.success) {
      drop("achievement", title.text, "invalid");
      continue;
    }
    achievements.push(parsed.data);
    achievementFlags.push(flags);
    report.achievements.kept += 1;
  }

  // Compétences déclarées : modèle (générales et par expérience) + LinkedIn + langages
  // GitHub, hors celles des réalisations.
  const used = new Set(achievements.flatMap((a) => a.skills.map(skillKey)));
  const skills = uniqueBy(
    redactList(
      [
        ...extraction.skills,
        ...extraction.experiences.flatMap((e) => e.skills),
        ...(linkedin?.skills ?? []),
        ...(github?.repos.flatMap((r) => r.languages) ?? []),
      ].map((s) => truncateSafe(s.trim(), LIMITS.skillName)),
      newFlags(),
    ),
    skillKey,
  )
    .filter((s) => !used.has(skillKey(s)))
    .slice(0, 100);

  const draft = ImportedDraft.parse({ experiences, achievements, skills });
  report.coverage = context.cvText ? checkCoverage(context.cvText, draft.experiences, now) : null;
  return {
    draft,
    flags: { experiences: experienceFlags, achievements: achievementFlags },
    identity,
    sources: { cv: false, linkedin: !!linkedin, github: !!github },
    report,
  };
}

// --- Pipeline complet ---------------------------------------------------------------

export async function runImport(
  sources: ImportSources,
  options: ImportOptions,
): Promise<ImportResult> {
  const hasSource = !!sources.cv?.length || !!sources.linkedin?.length || !!sources.github?.trim();
  if (!hasSource) throw new ImportError("noSource");

  const links = createLinkTable();
  // Extraction et collecte en parallèle, en mémoire.
  const [cvText, linkedin, github] = await Promise.all([
    sources.cv?.length ? extractCvText(sources.cv) : null,
    sources.linkedin?.length ? parseLinkedInExport(sources.linkedin) : null,
    sources.github?.trim()
      ? fetchGithubProfile(sources.github, {
          fetch: options.githubFetch,
          token: options.githubToken,
          signal: options.signal,
        })
      : null,
  ]);

  // Contacts retirés AVANT l'envoi au modèle (ordre fixe des liens : CV, LinkedIn, GitHub).
  const cv = cvText ? maskContacts(cvText, links) : null;
  const linkedinPrompt = linkedin ? linkedInText(linkedin, links) : undefined;
  const githubPrompt = github?.repos.length ? githubText(github, links) : undefined;

  const { object } = await options.ai.generateObject({
    purpose: "import.extract",
    schema: ExtractionSchema,
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    messages: buildExtractionMessages(
      { cv: cv?.text, linkedin: linkedinPrompt, github: githubPrompt },
      options.locale,
    ),
    temperature: 0,
    maxTokens: 8_000,
    signal: options.signal,
  });

  const result = buildResult(object, {
    linkedin,
    github,
    links,
    contacts: {
      emails: cv?.emails ?? [],
      phones: cv?.phones ?? [],
      identityLinks: cv?.identityLinks ?? [],
    },
    cvText: cv?.text,
  });
  result.sources.cv = !!cv;
  return result;
}
