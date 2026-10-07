"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { legalPath } from "@/lib/legal/pages";

const linkClass = "underline underline-offset-2 hover:text-stone-900";

/**
 * « En continuant, vous acceptez… » sous les formulaires d'inscription. La
 * version acceptée est enregistrée sur le compte (connexion) ou sur
 * l'organisation (création de l'espace entreprise).
 */
export function LegalConsent({ audience }: { audience: "candidate" | "company" }) {
  const t = useTranslations("legal.consent");
  return (
    <p className="text-xs leading-relaxed text-stone-500">
      {t.rich(audience, {
        terms: (chunks) => (
          <Link
            href={legalPath(audience === "company" ? "companyTerms" : "terms")}
            className={linkClass}
          >
            {chunks}
          </Link>
        ),
        privacy: (chunks) => (
          <Link href={legalPath("privacy")} className={linkClass}>
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
