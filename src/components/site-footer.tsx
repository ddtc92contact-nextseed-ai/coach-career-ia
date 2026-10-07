export function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} Coach Career IA — NextSeed-AI</p>
        <p>
          Vos données restent les vôtres : jamais revendues, jamais partagées sans votre accord.
        </p>
      </div>
    </footer>
  );
}
