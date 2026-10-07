import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth-card";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <AuthCard title={t("title")}>
      <p className="text-stone-600">{t("text")}</p>
      <Link href="/" className="text-brand-700 mt-6 inline-block underline underline-offset-4">
        {t("back")}
      </Link>
    </AuthCard>
  );
}
