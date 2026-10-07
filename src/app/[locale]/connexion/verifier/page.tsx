import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.verify");
  return { title: t("title") };
}

export default async function VerifyRequestPage() {
  const t = await getTranslations("auth.verify");
  return (
    <AuthCard title={t("title")}>
      <p className="text-stone-600">{t("text")}</p>
      <p className="mt-4 text-sm text-stone-500">
        {t.rich("help", {
          link: (chunks) => (
            <Link href="/connexion" className="text-brand-700 underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthCard>
  );
}
