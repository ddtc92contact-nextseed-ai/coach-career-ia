import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";

/** Rappel permanent : le coach est une IA, et il ne faut pas lui confier d'identité. */
export function AiNotice({ className = "mb-6" }: { className?: string }) {
  const t = useTranslations("coach");
  return (
    <p
      role="note"
      className={`border-line bg-surface text-ink-muted flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-xs ${className}`}
    >
      <span
        aria-hidden="true"
        className="bg-night text-signal inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold"
      >
        <Icon name="spark" className="size-3.5" />
        {t("aiBadge")}
      </span>
      <span className="text-pretty">{t("aiNotice")}</span>
    </p>
  );
}
