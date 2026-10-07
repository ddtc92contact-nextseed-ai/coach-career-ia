import { notFound } from "next/navigation";

// Toute URL inconnue d'une langue affiche la 404 traduite (`[locale]/not-found.tsx`).
export default function CatchAllPage() {
  notFound();
}
