import Link from "next/link";
import { AuthCard } from "@/components/auth-card";

export default function NotFound() {
  return (
    <AuthCard title="Page introuvable">
      <p className="text-stone-600">Cette page n&apos;existe pas ou a été déplacée.</p>
      <Link href="/" className="text-brand-700 mt-6 inline-block underline underline-offset-4">
        Retour à l&apos;accueil
      </Link>
    </AuthCard>
  );
}
