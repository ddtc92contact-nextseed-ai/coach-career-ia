"use client";

import { ErrorView } from "@/components/error-view";

export default function LocaleError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <ErrorView retry={retry} homeHref="/" />
    </main>
  );
}
