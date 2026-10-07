import { useTranslations } from "next-intl";

/** Rappel permanent : le coach est une IA, et il ne faut pas lui confier d'identité. */
export function AiNotice() {
  const t = useTranslations("coach");
  return (
    <p
      role="note"
      className="mb-6 flex gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700"
    >
      <span aria-hidden="true" className="font-semibold">
        IA
      </span>
      <span>{t("aiNotice")}</span>
    </p>
  );
}
