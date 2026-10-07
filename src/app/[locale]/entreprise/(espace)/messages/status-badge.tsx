import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import type { ThreadStatus } from "@/lib/employer/thread";

const TONE: Record<ThreadStatus, "neutral" | "proven" | "warning"> = {
  NEW: "warning",
  READ: "neutral",
  REPLIED: "proven",
  CLOSED: "neutral",
};

export async function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  const t = await getTranslations("employer.inbox.status");
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}
