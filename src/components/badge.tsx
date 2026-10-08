import type { ReactNode } from "react";

const TONES = {
  neutral: "bg-muted text-ink-muted ring-line",
  proven: "bg-brand-soft text-brand-ink ring-brand-line",
  warning: "bg-warning-soft text-warning-ink ring-warning-line",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
