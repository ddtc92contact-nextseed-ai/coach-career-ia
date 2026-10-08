import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { Icon, type IconName } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { PageHeader } from "@/components/page-header";
import { accountKdf } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";
import { getAlertSettings } from "@/lib/matching/repository";
import { AlertsForm } from "./alerts-form";
import { DeleteAccountForm } from "./delete-account-form";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/** Groupe de réglages : titre `h2` avec pictogramme, cartes `h3` en dessous. */
function Group({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2
        id={id}
        className="font-display flex items-center gap-3 text-xl font-bold tracking-tight sm:text-2xl"
      >
        <span
          aria-hidden="true"
          className="bg-brand-soft text-brand-ink inline-flex size-9 shrink-0 items-center justify-center rounded-xl"
        >
          <Icon name={icon} className="size-5" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SettingTitle({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon name={icon} className="text-ink-subtle size-5 shrink-0" />
      {children}
    </span>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [t, alerts, kdf] = await Promise.all([
    getTranslations("settings"),
    getAlertSettings(user.id),
    accountKdf(user.id),
  ]);
  const hasPassword = kdf !== null;
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} lead={t("intro")} />

      <div className="space-y-10">
        <Group id="groupe-compte" icon="user" title={t("groups.account")}>
          <Card id="mot-de-passe" className="scroll-mt-24" aria-labelledby="mot-de-passe-titre">
            <CardHeader
              id="mot-de-passe-titre"
              as="h3"
              title={<SettingTitle icon="key">{t("password.title")}</SettingTitle>}
              description={hasPassword ? t("password.introChange") : t("password.introSet")}
            />
            <div className="mt-5">
              <PasswordForm hasPassword={hasPassword} email={user.email} />
            </div>
          </Card>
        </Group>

        <Group id="groupe-preferences" icon="sliders" title={t("groups.preferences")}>
          <Card aria-labelledby="langue">
            <CardHeader
              id="langue"
              as="h3"
              title={<SettingTitle icon="globe">{t("language.title")}</SettingTitle>}
              description={t("language.intro")}
            />
            <div className="mt-5">
              <LocaleSwitcher persist showLabel />
            </div>
          </Card>

          <Card id="alertes" className="scroll-mt-24" aria-labelledby="alertes-titre">
            <CardHeader
              id="alertes-titre"
              as="h3"
              title={<SettingTitle icon="bell">{t("alerts.title")}</SettingTitle>}
              description={t("alerts.intro")}
            />
            <div className="mt-5">
              <AlertsForm frequency={alerts.frequency} minScore={alerts.minScore} />
            </div>
          </Card>
        </Group>

        <Group id="groupe-donnees" icon="server" title={t("groups.data")}>
          <Card aria-labelledby="export">
            <CardHeader
              id="export"
              as="h3"
              title={<SettingTitle icon="download">{t("export.title")}</SettingTitle>}
              description={t("export.intro")}
            />
            <a href="/api/account/export" download className={`${buttonClass("secondary")} mt-5`}>
              <Icon name="download" className="size-4" />
              {t("export.button")}
            </a>
          </Card>

          <Card aria-labelledby="suppression" className="border-danger-line">
            <CardHeader
              id="suppression"
              as="h3"
              title={
                <span className="text-danger-ink flex items-center gap-2">
                  <Icon name="trash" className="size-5 shrink-0" />
                  {t("delete.title")}
                </span>
              }
              description={t("delete.intro")}
            />
            <div className="border-danger-line bg-danger-soft/40 mt-5 rounded-xl border p-4">
              <DeleteAccountForm />
            </div>
          </Card>
        </Group>
      </div>
    </div>
  );
}
