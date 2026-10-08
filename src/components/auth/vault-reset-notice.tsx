import { useTranslations } from "next-intl";

/**
 * Règle à ne jamais travestir : après une réinitialisation par e-mail, le
 * coffre d'identité ne se rouvre qu'avec la clé de secours.
 */
export function VaultResetNotice() {
  const t = useTranslations("auth.vaultAfterReset");
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong className="font-semibold">{t("title")}</strong> {t("text")}
    </p>
  );
}
