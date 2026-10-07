/** Liste `ADMIN_EMAILS` (séparateur virgule), comparée sans tenir compte de la casse. */
export function adminEmails(raw: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string, raw?: string): boolean {
  const list = raw === undefined ? adminEmails() : adminEmails(raw);
  return list.includes(email.trim().toLowerCase());
}
