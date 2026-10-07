import { describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail } from "@/lib/auth/admin-emails";

describe("ADMIN_EMAILS", () => {
  it("accepte les adresses listées, sans tenir compte de la casse", () => {
    const raw = " Admin@Exemple.fr , autre@exemple.fr";
    expect(adminEmails(raw)).toEqual(["admin@exemple.fr", "autre@exemple.fr"]);
    expect(isAdminEmail("ADMIN@exemple.fr", raw)).toBe(true);
    expect(isAdminEmail("intrus@exemple.fr", raw)).toBe(false);
  });

  it("refuse tout le monde quand la variable est vide", () => {
    expect(isAdminEmail("admin@exemple.fr", "")).toBe(false);
  });
});
