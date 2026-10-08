import { useTranslations } from "next-intl";

/** Rappel permanent : le coach est une IA, et il ne faut pas lui confier d'identité. */
export function AiNotice() {
  const t = useTranslations("coach");
  return (
    <p
      role="note"
      className="border-line bg-subtle text-ink-muted mb-6 flex gap-2 rounded-lg border px-4 py-3 text-sm"
    >
      <span aria-hidden="true" className="font-semibold">
        {t("aiBadge")}
      </span>
      <span>{t("aiNotice")}</span>
    </p>
  );
}
