import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/card";
import { PublicFrame } from "@/components/public-frame";
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
    <PublicFrame title={t("title")} lead={t("intro", { title: target.offer.title })}>
      <Card>
        <ReplyForm token={token} />
      </Card>
      <Link
        href={`/p/${token}`}
        className="text-ink-muted hover:text-ink mt-6 inline-block font-medium hover:underline hover:underline-offset-4"
      >
        {t("back")}
      </Link>
    </PublicFrame>
  );
}
