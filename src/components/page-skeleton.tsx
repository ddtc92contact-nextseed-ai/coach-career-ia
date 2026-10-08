import { getTranslations } from "next-intl/server";

function Bar({ className = "" }: { className?: string }) {
  return <span className={`bg-muted block rounded-full ${className}`} />;
}

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-7">
      <Bar className="h-5 w-2/5" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Bar key={i} className={`h-3.5 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Squelette affiché pendant le chargement d'une page de l'application
 * (`loading.tsx`) : même silhouette que la page, annoncé une fois aux lecteurs
 * d'écran, pulsation seulement hors mouvement réduit. Jamais de chargement sans
 * fin : la page remplace le squelette, ou `error.tsx` prend le relais.
 */
export async function PageSkeleton({
  variant = "list",
  band = true,
}: {
  /** `list` : cartes empilées ; `detail` : contenu et colonne latérale ; `chat` : fil. */
  variant?: "list" | "detail" | "chat" | "form";
  /** En-tête avec bandeau de couleur (comme `PageHeader band`). */
  band?: boolean;
}) {
  const t = await getTranslations("common");
  return (
    <div role="status" aria-busy="true" className="motion-safe:animate-pulse">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden="true">
        <div
          className={`mb-8 lg:mb-10 ${
            band ? "band-brand border-brand-line rounded-3xl border px-5 py-7 sm:px-8 sm:py-9" : ""
          }`}
        >
          <Bar className="h-3.5 w-28" />
          <Bar className="mt-4 h-8 w-2/3 max-w-md" />
          <Bar className="mt-4 h-4 w-full max-w-xl" />
        </div>
        {variant === "chat" ? (
          <div className="mx-auto max-w-3xl space-y-4">
            {[70, 45, 80].map((width, i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                <div
                  className="border-line bg-surface h-20 rounded-2xl border"
                  style={{ width: `${width}%` }}
                />
              </div>
            ))}
            <div className="border-line bg-surface mt-8 h-28 rounded-2xl border" />
          </div>
        ) : variant === "detail" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-6">
              <CardSkeleton lines={4} />
              <CardSkeleton lines={3} />
            </div>
            <div className="space-y-6">
              <CardSkeleton lines={2} />
              <CardSkeleton lines={3} />
            </div>
          </div>
        ) : variant === "form" ? (
          <div className="max-w-3xl space-y-6">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={2} />
          </div>
        ) : (
          <div className="space-y-4">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        )}
      </div>
    </div>
  );
}
