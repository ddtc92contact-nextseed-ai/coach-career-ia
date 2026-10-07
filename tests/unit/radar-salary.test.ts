import { describe, expect, it } from "vitest";
import { parseSalaryText, withComplements } from "@/lib/radar/salary";

describe("parseSalaryText", () => {
  it.each([
    ["45-55 k€", 45000, 55000, "YEAR"],
    ["45k€ - 55k€", 45000, 55000, "YEAR"],
    ["€46K – €53K", 46000, 53000, "YEAR"],
    ["50 000 € annuel", 50000, 50000, "YEAR"],
    ["50.000€", 50000, 50000, "YEAR"],
    ["de 35 000 à 40 000 euros brut par an", 35000, 40000, "YEAR"],
    ["Annuel de 45000.00 Euros à 55000.00 Euros sur 12.0 mois", 45000, 55000, "YEAR"],
    ["2 500 € / mois", 2500, 2500, "MONTH"],
    ["Mensuel de 2500.00 Euros à 2800.00 Euros sur 12 mois", 2500, 2800, "MONTH"],
    ["2 500 € brut mensuel sur 13 mois", 2500, 2500, "MONTH"],
    ["450 €/jour", 450, 450, "DAY"],
    ["TJM : 500 à 600 €", 500, 600, "DAY"],
    ["Horaire de 11.88 Euros sur 12 mois", 11.88, 11.88, "HOUR"],
    ["11,88 € de l'heure", 11.88, 11.88, "HOUR"],
  ])("« %s » → %d–%d / %s", (text, min, max, period) => {
    const salary = parseSalaryText(text);
    expect(salary).toMatchObject({ min, max, period, currency: "EUR" });
    expect(salary?.raw).toBe(text);
  });

  it("borne haute seule : « jusqu'à 60 k€ »", () => {
    expect(parseSalaryText("jusqu'à 60 k€")).toMatchObject({
      min: null,
      max: 60000,
      period: "YEAR",
    });
  });

  it("borne basse seule : « à partir de 40 000 € brut annuel »", () => {
    expect(parseSalaryText("à partir de 40 000 € brut annuel")).toMatchObject({
      min: 40000,
      max: null,
      period: "YEAR",
    });
  });

  it.each([
    [""],
    ["   "],
    ["Selon profil"],
    ["À négocier"],
    ["Salaire attractif"],
    [null],
    [undefined],
  ])("aucun montant annoncé (%s) → null", (text) => {
    expect(parseSalaryText(text)).toBeNull();
  });

  it("n'invente rien sans devise : « 45-55 » → null", () => {
    expect(parseSalaryText("45-55")).toBeNull();
  });

  it("ne déduit pas de période d'un petit montant sans unité", () => {
    expect(parseSalaryText("Salaire : 1800 euros")).toMatchObject({ min: 1800, period: null });
  });

  it("ignore les nombres sans rapport avec la rémunération", () => {
    expect(parseSalaryText("Poste à Paris 15, salaire 45 000 € par an")).toMatchObject({
      min: 45000,
      max: 45000,
    });
  });

  it("sépare le fixe du variable et de l'equity", () => {
    expect(parseSalaryText("45k€ fixe + 10k€ variable")).toMatchObject({
      min: 45000,
      max: 45000,
      variable: "10k€ variable",
    });
    expect(parseSalaryText("entre 35 et 40 K€ + BSPCE")).toMatchObject({
      min: 35000,
      max: 40000,
      equity: "BSPCE",
    });
  });
});

describe("withComplements", () => {
  it("ajoute les primes annoncées en part variable", () => {
    const salary = withComplements(parseSalaryText("45-55 k€"), ["Prime", "Mutuelle"]);
    expect(salary).toMatchObject({ min: 45000, variable: "Prime" });
  });

  it("reste null sans salaire ni variable", () => {
    expect(withComplements(null, ["Mutuelle", null])).toBeNull();
  });
});
