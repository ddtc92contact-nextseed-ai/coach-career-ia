import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
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
  icon,
}: {
  title: string;
  text: string;
  action?: ReactNode;
  /** Icône de la charte au-dessus du titre (facultative). */
  icon?: IconName;
}) {
  return (
    <div className="border-line-strong bg-surface rounded-2xl border border-dashed px-6 py-10 text-center">
      {icon ? (
        <span className="bg-brand-soft text-brand-ink mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-2xl">
          <Icon name={icon} className="size-6" />
        </span>
      ) : null}
      <p className="font-medium">{title}</p>
      <p className="text-ink-subtle mx-auto mt-2 max-w-md text-sm">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
