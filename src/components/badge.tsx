import type { ReactNode } from "react";

const TONES = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  proven: "bg-brand-50 text-brand-800 ring-brand-100",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
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
