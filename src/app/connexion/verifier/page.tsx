import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";

export const metadata: Metadata = { title: "Vérifiez votre boîte mail" };

export default function VerifyRequestPage() {
  return (
    <AuthCard title="Vérifiez votre boîte mail">
      <p className="text-stone-600">
        Si l&apos;adresse saisie est valide, un lien de connexion vient de vous être envoyé. Il est
        valable 15 minutes et ne fonctionne qu&apos;une seule fois.
      </p>
      <p className="mt-4 text-sm text-stone-500">
        Rien reçu ? Pensez à vérifier vos courriers indésirables, puis{" "}
        <Link href="/connexion" className="text-brand-700 underline underline-offset-4">
          demandez un nouveau lien
        </Link>
        .
      </p>
    </AuthCard>
  );
}
