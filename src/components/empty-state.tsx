import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";

/** Ancienne API des écrans existants : `PageHeader` sans bandeau. */
export function PageTitle({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return <PageHeader title={title} lead={intro} actions={action} />;
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
