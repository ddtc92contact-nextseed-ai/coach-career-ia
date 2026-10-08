import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <AuthCard title={t("title")} panel={false}>
      <p className="text-ink-muted text-pretty">{t("text")}</p>
      <Link href="/" className={`${buttonClass("primary", "lg")} mt-7 max-sm:w-full`}>
        {t("back")}
        <Icon name="arrow" className="size-4" />
      </Link>
    </AuthCard>
  );
}
