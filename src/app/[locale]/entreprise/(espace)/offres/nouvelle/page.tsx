import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { countryNames } from "@/lib/employer/countries";
import { requireEmployer } from "@/lib/employer/session";
import { BackLink, OrganizationNotice } from "../../parts";
import { createPostingAction } from "../actions";
import { EMPTY_POSTING, PostingForm } from "../posting-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.posting");
  return { title: t("newTitle") };
}

export default async function NewPostingPage() {
  const { org } = await requireEmployer();
  const [t, locale] = await Promise.all([getTranslations("employer.posting"), getLocale()]);
  return (
    <div className="max-w-4xl">
      <BackLink href="/entreprise">{t("back")}</BackLink>
      <div>
        <OrganizationNotice org={org} />
        <PageHeader title={t("newTitle")} lead={t("newIntro")} />
        <PostingForm
          action={createPostingAction}
          initial={EMPTY_POSTING}
          submitLabel={t("create")}
          countryNames={countryNames(locale)}
        />
      </div>
    </div>
  );
}
