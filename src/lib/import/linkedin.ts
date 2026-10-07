import { strFromU8 } from "fflate";
import { csvRecords } from "./csv";
import { ImportError } from "./errors";
import { sniffType, unzipSelected } from "./extract";
import { IMPORT_LIMITS } from "./shared";

/**
 * Lecture de l'archive RGPD téléchargée par le candidat sur LinkedIn
 * (« Obtenir une copie de vos données »). Seuls les CSV utiles sont
 * décompressés, en mémoire : messages, relations, invitations… ne sont
 * jamais lus.
 */

const WANTED = [
  "profile.csv",
  "email addresses.csv",
  "phonenumbers.csv",
  "positions.csv",
  "education.csv",
  "skills.csv",
  "projects.csv",
  "certifications.csv",
] as const;
type Wanted = (typeof WANTED)[number];

export type LinkedInPosition = {
  /** Référence stable proposée au modèle (`li-1`…). */
  ref: string;
  company: string;
  title: string;
  description: string;
  location: string;
  startMonth: string | null;
  endMonth: string | null;
};

export type LinkedInExport = {
  firstName: string;
  lastName: string;
  headline: string;
  summary: string;
  websites: string[];
  emails: string[];
  phones: string[];
  positions: LinkedInPosition[];
  education: {
    school: string;
    degree: string;
    startYear: string;
    endYear: string;
    notes: string;
  }[];
  skills: string[];
  projects: { title: string; description: string; url: string; startMonth: string | null }[];
  certifications: { name: string; authority: string; url: string; startMonth: string | null }[];
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  // Exports dans d'autres langues.
  janv: 1,
  fevr: 2,
  fev: 2,
  mars: 3,
  avr: 4,
  mai: 5,
  juin: 6,
  juil: 7,
  aout: 8,
  sept: 9,
  dic: 12,
  ene: 1,
  abr: 4,
  ago: 8,
  mrt: 3,
  mei: 5,
  okt: 10,
  dez: 12,
  mag: 5,
  giu: 6,
  lug: 7,
  set: 9,
  ott: 10,
};

/** `Jan 2020`, `2020-01`, `01/2020`, `2020` → `AAAA-MM` (janvier si le mois manque). */
export function parseLinkedInMonth(value: string): string | null {
  const text = value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})/.exec(text);
  if (match) return month(match[1]!, Number(match[2]));
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return month(match[2]!, Number(match[1]));
  match = /^([a-z]+)\.?\s+(\d{4})$/.exec(text);
  if (match) {
    const index = MONTHS[match[1]!.slice(0, 4)] ?? MONTHS[match[1]!.slice(0, 3)];
    return index ? month(match[2]!, index) : null;
  }
  match = /^(\d{4})$/.exec(text);
  return match ? month(match[1]!, 1) : null;
}

function month(year: string, index: number): string | null {
  if (index < 1 || index > 12) return null;
  return `${year}-${String(index).padStart(2, "0")}`;
}

const URL_PATTERN = /https?:\/\/[^\s,\]\[<>"]+/gi;

function baseName(path: string): string {
  return (path.split("/").pop() ?? path).toLowerCase();
}

export function parseLinkedInExport(bytes: Uint8Array): LinkedInExport {
  if (bytes.length > IMPORT_LIMITS.linkedinMaxBytes) throw new ImportError("linkedinTooLarge");
  if (sniffType(bytes) !== "zip") throw new ImportError("linkedinInvalid");

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSelected(
      bytes,
      (name) => (WANTED as readonly string[]).includes(baseName(name)),
      IMPORT_LIMITS.linkedinCsvMaxBytes,
    );
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("linkedinInvalid");
  }
  const files = new Map<Wanted, string>();
  for (const [name, content] of Object.entries(entries)) {
    files.set(baseName(name) as Wanted, strFromU8(content));
  }
  if (!files.has("positions.csv") && !files.has("profile.csv") && !files.has("skills.csv")) {
    throw new ImportError("linkedinInvalid");
  }
  const read = (file: Wanted, column: string) => {
    const content = files.get(file);
    return content ? csvRecords(content, column) : [];
  };

  const profile = read("profile.csv", "First Name")[0] ?? {};
  const positions = read("positions.csv", "Company Name")
    .filter((row) => row["Title"] || row["Company Name"])
    .map((row, index) => ({
      ref: `li-${index + 1}`,
      company: row["Company Name"] ?? "",
      title: row["Title"] ?? "",
      description: row["Description"] ?? "",
      location: row["Location"] ?? "",
      startMonth: parseLinkedInMonth(row["Started On"] ?? ""),
      endMonth: parseLinkedInMonth(row["Finished On"] ?? ""),
    }));

  return {
    firstName: profile["First Name"] ?? "",
    lastName: profile["Last Name"] ?? "",
    headline: profile["Headline"] ?? "",
    summary: profile["Summary"] ?? "",
    websites: [...(profile["Websites"] ?? "").matchAll(URL_PATTERN)].map((m) => m[0]),
    emails: read("email addresses.csv", "Email Address")
      .map((row) => row["Email Address"] ?? "")
      .filter(Boolean),
    phones: read("phonenumbers.csv", "Number")
      .map((row) => row["Number"] ?? "")
      .filter(Boolean),
    positions,
    education: read("education.csv", "School Name").map((row) => ({
      school: row["School Name"] ?? "",
      degree: row["Degree Name"] ?? "",
      startYear: (row["Start Date"] ?? "").slice(0, 4),
      endYear: (row["End Date"] ?? "").slice(0, 4),
      notes: row["Notes"] ?? "",
    })),
    skills: read("skills.csv", "Name")
      .map((row) => row["Name"] ?? "")
      .filter(Boolean),
    projects: read("projects.csv", "Title").map((row) => ({
      title: row["Title"] ?? "",
      description: row["Description"] ?? "",
      url: row["Url"] ?? "",
      startMonth: parseLinkedInMonth(row["Started On"] ?? ""),
    })),
    certifications: read("certifications.csv", "Name").map((row) => ({
      name: row["Name"] ?? "",
      authority: row["Authority"] ?? "",
      url: row["Url"] ?? "",
      startMonth: parseLinkedInMonth(row["Started On"] ?? ""),
    })),
  };
}
