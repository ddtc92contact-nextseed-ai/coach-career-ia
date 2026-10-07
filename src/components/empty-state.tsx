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
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro ? <p className="mt-2 max-w-2xl text-stone-600">{intro}</p> : null}
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
    <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
