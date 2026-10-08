import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { replyTarget } from "@/lib/contact/repository";
import { ReplyForm } from "./reply-form";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("replyPage");
  return {
    title: t("title"),
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/**
 * Page de réponse d'une entreprise. Autorisée uniquement par un jeton actif
 * lié à une prise de contact ENVOYÉE (un lien de carte créé à la main n'ouvre
 * pas cette page) : sinon 404.
 */
export default async function ReplyPage({ params }: Props) {
  const { token } = await params;
  const target = await replyTarget(token);
  if (!target) notFound();
  const t = await getTranslations("replyPage");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="border-line bg-surface rounded-2xl border p-5 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-ink-muted mt-2 text-sm">{t("intro", { title: target.offer.title })}</p>
        <div className="mt-6">
          <ReplyForm token={token} />
        </div>
      </div>
      <Link href={`/p/${token}`} className="text-ink-muted mt-6 text-sm hover:underline">
        {t("back")}
      </Link>
    </main>
  );
}
