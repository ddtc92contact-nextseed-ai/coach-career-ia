import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-stone-900 text-sm text-white"
      >
        CC
      </span>
      <span>Coach Career IA</span>
    </Link>
  );
}
