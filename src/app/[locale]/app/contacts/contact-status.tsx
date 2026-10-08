import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/badge";
import type { IconName } from "@/components/icons";

type ContactSummary = {
  status: "DRAFT" | "APPROVED" | "SENDING" | "SENT";
  replies: number;
  unread: number;
};

/** Un contact attend la personne : brouillon à approuver, message à envoyer, réponse non lue. */
export function needsAction(contact: ContactSummary): boolean {
  return contact.status === "DRAFT" || contact.status === "APPROVED" || contact.unread > 0;
}

/**
 * Pastille d'état d'un contact, colorée selon ce qu'il attend : brouillon à
 * approuver (ambre), approuvé (vert doux), envoyé, réponse reçue (vert plein).
 */
export function ContactStatusBadge({ contact }: { contact: ContactSummary }) {
  const t = useTranslations("contacts");
  let tone: BadgeTone = "neutral";
  let icon: IconName = "clock";
  let label: string;
  if (contact.status === "DRAFT") {
    tone = "warning";
    label = t("inbox.awaitingApproval");
  } else if (contact.status === "APPROVED") {
    tone = "proven";
    icon = "approve";
    label = t("status.APPROVED");
  } else if (contact.status === "SENDING") {
    label = t("status.SENDING");
  } else if (contact.unread > 0) {
    tone = "brand";
    icon = "reply";
    label = t("unread", { count: contact.unread });
  } else if (contact.replies > 0) {
    tone = "proven";
    icon = "reply";
    label = t("replies", { count: contact.replies });
  } else {
    icon = "send";
    label = t("status.SENT");
  }
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}
