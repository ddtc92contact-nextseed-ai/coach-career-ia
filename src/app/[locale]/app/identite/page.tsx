import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { listExperiences } from "@/lib/career/repository";
import { IdentityVaultPanel } from "./identity-vault";
import { VaultState } from "./vault-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("identity");
  return { title: t("title") };
}

/** Les quatre garanties du coffre à connaissance nulle, dans l'ordre du trajet des données. */
const GUARANTEES: { key: "encrypted" | "nobody" | "you" | "handover"; icon: IconName }[] = [
  { key: "encrypted", icon: "lock" },
  { key: "nobody", icon: "server" },
  { key: "you", icon: "key" },
  { key: "handover", icon: "approve" },
];

/**
 * « Mon identité » : le coffre est entièrement géré dans le navigateur. Le
 * serveur ne fournit ici que la liste (pseudonymisée) des expériences, pour
 * relier chaque employeur réel à son expérience.
 */
export default async function IdentityPage() {
  const user = await requireUser();
  const [t, format, experiences] = await Promise.all([
    getTranslations("identity"),
    getFormatter(),
    listExperiences(user.id),
  ]);
  const options = experiences.map((e) => ({
    id: e.id,
    label: `${e.roleTitle} (${format.dateTime(e.startMonth, "month")})`,
  }));
  return (
    <>
      <PageHeader
        band="night"
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("intro")}
        actions={<VaultState />}
      >
        <section aria-labelledby="zero-connaissance" className="mt-8">
          <h2 id="zero-connaissance" className="text-on-night text-xl font-bold tracking-tight">
            {t("explain.title")}
          </h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {GUARANTEES.map((item) => (
              <li
                key={item.key}
                className="border-night-line bg-night-raised/70 rounded-2xl border p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-signal/15 text-signal inline-flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <Icon name={item.icon} className="size-5" />
                  </span>
                  <h3 className="text-on-night font-semibold">{t(`explain.steps.${item.key}`)}</h3>
                </div>
                <p className="text-on-night-muted mt-3 text-sm text-pretty">
                  {t(`explain.${item.key}`)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </PageHeader>

      <p className="border-warning-line bg-warning-soft text-warning-ink mb-6 flex items-start gap-3 rounded-2xl border px-5 py-4">
        <Icon name="key" className="mt-0.5 size-5 shrink-0" />
        <span>
          <strong className="font-semibold">{t("explain.lossTitle")}</strong> {t("explain.loss")}
        </span>
      </p>

      <IdentityVaultPanel experiences={options} />
    </>
  );
}
