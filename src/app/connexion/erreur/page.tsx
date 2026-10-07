import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";

export const metadata: Metadata = { title: "Connexion impossible" };

const MESSAGES: Record<string, string> = {
  Verification:
    "Ce lien de connexion a expiré ou a déjà été utilisé. Demandez-en un nouveau : il reste valable 15 minutes.",
  Configuration:
    "Le service de connexion est momentanément indisponible. Réessayez dans quelques instants.",
  AccessDenied: "L'accès a été refusé.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    (error && MESSAGES[error]) ?? "Une erreur est survenue pendant la connexion. Réessayez.";

  return (
    <AuthCard title="Connexion impossible">
      <p className="text-stone-600">{message}</p>
      <Link
        href="/connexion"
        className="mt-6 inline-block rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700"
      >
        Demander un nouveau lien
      </Link>
    </AuthCard>
  );
}
