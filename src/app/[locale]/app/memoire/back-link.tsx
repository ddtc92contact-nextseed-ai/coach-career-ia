import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";

/** Retour à « Ma mémoire de carrière », à la section d'origine. */
export async function BackToMemory({ anchor }: { anchor?: "experiences" | "realisations" }) {
  const t = await getTranslations("memory");
  return (
    <Link
      href={anchor ? `/app/memoire#${anchor}` : "/app/memoire"}
      className="text-ink-muted hover:text-ink mb-4 inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
    >
      <Icon name="arrow" className="size-4 rotate-180" />
      {t("back")}
    </Link>
  );
}
