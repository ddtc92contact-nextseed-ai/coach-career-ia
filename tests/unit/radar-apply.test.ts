import { describe, expect, it } from "vitest";
import {
  applyChannel,
  applyEmailFromText,
  cleanApplyUrl,
  cleanEmail,
  isPersonalEmail,
} from "@/lib/radar/apply";
import { mapAshbyJob, type AshbyJob } from "@/lib/radar/connectors/ashby";
import {
  mapFranceTravailOffer,
  type FranceTravailOffer,
} from "@/lib/radar/connectors/france-travail";
import { mapGreenhouseJob, type GreenhouseJob } from "@/lib/radar/connectors/greenhouse";
import { mapLeverPosting, type LeverPosting } from "@/lib/radar/connectors/lever";
import { mapRecruiteeOffer, type RecruiteeOffer } from "@/lib/radar/connectors/recruitee";
import {
  mapSmartRecruitersPosting,
  type SmartRecruitersPosting,
} from "@/lib/radar/connectors/smartrecruiters";
import { mapWorkableJob, type WorkableJob } from "@/lib/radar/connectors/workable";
import { company, fixtureJson } from "../helpers/radar";

describe("canal de candidature : règles", () => {
  it("distingue une adresse de service d'une adresse nominative", () => {
    for (const email of [
      "recrutement@acme.fr",
      "rh@acme.fr",
      "jobs@alan.example",
      "careers.paris@exemple.com",
      "candidatures2026@exemple.fr",
      "recrutementparis@exemple.fr",
      "bewerbung@firma.de",
      "vacatures@bedrijf.nl",
      "lavoro@azienda.it",
      "empleo@empresa.es",
    ]) {
      expect(isPersonalEmail(email), email).toBe(false);
    }
    for (const email of [
      "jean.fictif@matera.example",
      "jdupont@acme.fr",
      "claire-exemple@acme.fr",
      "c.martin@acme.fr",
    ]) {
      expect(isPersonalEmail(email), email).toBe(true);
    }
  });

  it("extrait une adresse valide d'un texte libre", () => {
    expect(cleanEmail("Pour postuler : RH@Acme.fr.")).toBe("rh@acme.fr");
    expect(cleanEmail("pas d'adresse")).toBeNull();
    expect(cleanEmail(null)).toBeNull();
  });

  it("n'accepte que des URL http(s) absolues", () => {
    expect(cleanApplyUrl(" https://acme.fr/postuler?id=1 ")).toBe("https://acme.fr/postuler?id=1");
    expect(cleanApplyUrl("lien : https://acme.fr/apply).")).toBe("https://acme.fr/apply");
    expect(cleanApplyUrl("javascript:alert(1)")).toBeNull();
    expect(cleanApplyUrl("acme.fr/postuler")).toBeNull();
  });

  it("ne lit dans le texte qu'une adresse annoncée pour candidater", () => {
    expect(applyEmailFromText("Envoyez votre CV à recrutement@acme.fr avant le 1er mai.")).toBe(
      "recrutement@acme.fr",
    );
    expect(applyEmailFromText("Please send your resume to talent@acme.io")).toBe("talent@acme.io");
    expect(applyEmailFromText("Bewerbungen bitte an karriere@firma.de")).toBe("karriere@firma.de");
    // Adresse sans rapport avec la candidature (support client, DPO) : ignorée.
    expect(applyEmailFromText("Nos clients écrivent à support@acme.fr.")).toBeNull();
    expect(applyEmailFromText("Postulez en ligne. Le DPO répond à dpo@acme.fr.")).toBeNull();
  });

  it("combine e-mail de la source, texte de l'offre et URL", () => {
    expect(applyChannel({ email: "Jean.Dupont@acme.fr", url: "https://acme.fr/apply" })).toEqual({
      email: "jean.dupont@acme.fr",
      emailPersonal: true,
      url: "https://acme.fr/apply",
    });
    expect(applyChannel({ description: "Candidature à rh@acme.fr" })).toEqual({
      email: "rh@acme.fr",
      emailPersonal: false,
      url: null,
    });
    expect(applyChannel({})).toEqual({ email: null, emailPersonal: false, url: null });
  });
});

describe("canal de candidature : connecteurs (fixtures)", () => {
  it("France Travail : adresse nominative conservée mais signalée", () => {
    const [matera] = fixtureJson<{ resultats: FranceTravailOffer[] }>(
      "france-travail-ats-v2.json",
    ).resultats;
    const offer = mapFranceTravailOffer(matera!)!;
    expect(offer.apply).toEqual({
      email: "jean.fictif@matera.example",
      emailPersonal: true,
      url: null,
    });
    // Le nom du recruteur n'est jamais repris.
    expect(JSON.stringify(offer)).not.toMatch(/Jean Fictif/);
  });

  it("Greenhouse : la page de l'offre porte le formulaire", () => {
    const [job] = fixtureJson<{ jobs: GreenhouseJob[] }>("greenhouse-dataiku.json").jobs;
    expect(mapGreenhouseJob(job!, company())!.apply).toEqual({
      email: null,
      emailPersonal: false,
      url: "https://job-boards.greenhouse.io/dataiku/jobs/5420293004",
    });
  });

  it("Lever et Ashby : URL de candidature publiée", () => {
    const [posting] = fixtureJson<LeverPosting[]>("lever-qonto.json");
    expect(mapLeverPosting(posting!, company({ atsType: "LEVER" }))!.apply?.url).toBe(
      "https://jobs.lever.co/qonto/ee6d81ef-6212-4c6f-b13c-b97fa8cff981/apply",
    );
    const [job] = fixtureJson<{ jobs: AshbyJob[] }>("ashby-alan.json").jobs;
    expect(mapAshbyJob(job!, company({ atsType: "ASHBY" }))!.apply?.url).toBe(
      "https://jobs.ashbyhq.com/alan/8ec3768e-13cf-4e92-ba14-5d2a9484227c/application",
    );
  });

  it("SmartRecruiters, Recruitee et Workable (radar v2) : URL de candidature publiée", () => {
    const postings = fixtureJson<Record<string, SmartRecruitersPosting>>(
      "smartrecruiters-nexity-postings.json",
    );
    const sr = mapSmartRecruitersPosting(
      postings["744000153698949"]!,
      company({ atsType: "SMARTRECRUITERS", boardToken: "Nexity" }),
    )!;
    expect(sr.apply?.url).toBe(
      "https://jobs.smartrecruiters.com/Nexity/744000153698949-controleur-de-gestion-h-f-cdi?oga=true",
    );

    const [recruitee] = fixtureJson<{ offers: RecruiteeOffer[] }>("recruitee-matera.json").offers;
    expect(mapRecruiteeOffer(recruitee!, company({ atsType: "RECRUITEE" }))!.apply?.url).toBe(
      "https://matera.recruitee.com/o/cdi-gestionnaire-de-coproprietes-idf/c/new",
    );

    const [workable] = fixtureJson<{ jobs: WorkableJob[] }>("workable-exotec.json").jobs;
    expect(mapWorkableJob(workable!, company({ atsType: "WORKABLE" }))!.apply).toEqual({
      email: null,
      emailPersonal: false,
      url: "https://apply.workable.com/j/C005979099/apply",
    });
  });
});
