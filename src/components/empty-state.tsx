import type { ReactNode } from "react";

export function PageTitle({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {intro ? <p className="text-ink-muted mt-2 max-w-2xl">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-line-strong bg-surface rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-ink-subtle mx-auto mt-2 max-w-md text-sm">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
