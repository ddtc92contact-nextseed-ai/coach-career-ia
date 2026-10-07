import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getCurrentUser } from "@/lib/auth/session";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);
  if (await getCurrentUser()) redirect(callbackUrl);

  return (
    <AuthCard title="Connexion à votre espace">
      <p className="mb-6 text-sm text-stone-600">
        Pas de mot de passe : saisissez votre adresse e-mail, nous vous envoyons un lien de
        connexion à usage unique. Si vous n&apos;avez pas encore d&apos;espace, il sera créé à la
        première connexion.
      </p>
      <LoginForm callbackUrl={callbackUrl} />
      <p className="mt-6 text-center text-sm">
        <Link href="/" className="text-stone-500 underline-offset-4 hover:underline">
          Retour à l&apos;accueil
        </Link>
      </p>
    </AuthCard>
  );
}
