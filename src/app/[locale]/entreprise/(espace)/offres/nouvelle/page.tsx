import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { countryNames } from "@/lib/employer/countries";
import { requireEmployer } from "@/lib/employer/session";
import { OrganizationNotice } from "../../parts";
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
    <div className="max-w-3xl">
      <Link href="/entreprise" className="text-sm text-stone-600 hover:underline">
        {t("back")}
      </Link>
      <div className="mt-4">
        <OrganizationNotice org={org} />
        <PageTitle title={t("newTitle")} intro={t("newIntro")} />
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
