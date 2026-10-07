import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { listExperiences } from "@/lib/career/repository";
import { IdentityVaultPanel } from "./identity-vault";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("identity");
  return { title: t("title") };
}

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
    <div className="max-w-3xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      <IdentityVaultPanel experiences={options} />
    </div>
  );
}
