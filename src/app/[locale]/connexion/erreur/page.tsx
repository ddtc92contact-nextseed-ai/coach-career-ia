import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
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
      <p className="text-stone-600">{known ? t(`messages.${known}`) : t("messages.Default")}</p>
      <Link
        href="/connexion"
        className="mt-6 inline-block rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700"
      >
        {t("retry")}
      </Link>
    </AuthCard>
  );
}
