import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/badge";
import type { ThreadStatus } from "@/lib/employer/thread";

const TONE: Record<ThreadStatus, BadgeTone> = {
  NEW: "warning",
  READ: "neutral",
  REPLIED: "proven",
  CLOSED: "neutral",
};

export async function ThreadStatusBadge({
  status,
  size = "md",
}: {
  status: ThreadStatus;
  size?: "sm" | "md";
}) {
  const t = await getTranslations("employer.inbox.status");
  return (
    <Badge tone={TONE[status]} size={size} dot>
      {t(status)}
    </Badge>
  );
}
