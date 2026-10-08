import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/button";
import { Link } from "@/i18n/navigation";

const KNOWN_ERRORS = ["Verification", "Configuration", "AccessDenied"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.error");
  return { title: t("title") };
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const t = await getTranslations("auth.error");
  const known = KNOWN_ERRORS.find((code): code is KnownError => code === error);

  return (
    <AuthCard title={t("title")}>
      <p className="text-ink-muted">{known ? t(`messages.${known}`) : t("messages.Default")}</p>
      <Link href="/connexion" className={`${buttonClass("primary", "lg")} mt-7 w-full sm:w-auto`}>
        {t("retry")}
      </Link>
    </AuthCard>
  );
}
