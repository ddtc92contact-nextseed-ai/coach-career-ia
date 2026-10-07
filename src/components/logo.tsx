import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Logo({ href = "/" }: { href?: string }) {
  const t = useTranslations("metadata");
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-stone-900 text-sm text-white"
      >
        CC
      </span>
      <span className="truncate max-sm:sr-only">{t("siteName")}</span>
    </Link>
  );
}
