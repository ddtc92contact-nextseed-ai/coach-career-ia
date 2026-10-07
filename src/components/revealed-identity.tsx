import { useTranslations } from "next-intl";
import { isHttpUrl, type RevealedIdentity } from "@/lib/handover/schema";

/**
 * Identité révélée telle que l'entreprise la voit : page « profil révélé »
 * et aperçu du candidat avant confirmation (même rendu). Composant sans état,
 * utilisable côté serveur comme dans le navigateur.
 */
export function RevealedIdentityView({
  identity,
  cvHref,
}: {
  identity: RevealedIdentity;
  /** Lien de téléchargement du CV (page publique) ; absent dans l'aperçu. */
  cvHref?: string;
}) {
  const t = useTranslations("handover.fields");
  const name = identity.name
    ? [identity.name.firstName, identity.name.lastName].filter(Boolean).join(" ")
    : null;
  const row = "grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3";
  const label = "text-sm text-stone-500";
  const value = "text-sm text-stone-900 [overflow-wrap:anywhere] break-words";
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
      {name ? <p className="text-xl font-semibold tracking-tight break-words">{name}</p> : null}
      <dl className={`space-y-3 ${name ? "mt-4" : ""}`}>
        {identity.email ? (
          <div className={row}>
            <dt className={label}>{t("email")}</dt>
            <dd className={value}>
              <a href={`mailto:${identity.email}`} className="underline">
                {identity.email}
              </a>
            </dd>
          </div>
        ) : null}
        {identity.phone ? (
          <div className={row}>
            <dt className={label}>{t("phone")}</dt>
            <dd className={value}>{identity.phone}</dd>
          </div>
        ) : null}
        {identity.links?.length ? (
          <div className={row}>
            <dt className={label}>{t("links")}</dt>
            <dd className={value}>
              <ul className="space-y-1">
                {identity.links.map((l, i) => (
                  <li key={i}>
                    {l.label ? <span className="text-stone-600">{l.label} : </span> : null}
                    {isHttpUrl(l.url) ? (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline"
                      >
                        {l.url}
                      </a>
                    ) : (
                      l.url
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {identity.employers?.length ? (
          <div className={row}>
            <dt className={label}>{t("employers")}</dt>
            <dd className={value}>
              <ul className="space-y-1">
                {identity.employers.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{e.name}</span>
                    {e.role ? <span className="text-stone-600"> — {e.role}</span> : null}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {identity.schools?.length ? (
          <div className={row}>
            <dt className={label}>{t("schools")}</dt>
            <dd className={value}>
              <ul className="space-y-1">
                {identity.schools.map((s, i) => (
                  <li key={i}>{s.name}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {identity.cv ? (
          <div className={row}>
            <dt className={label}>{t("cv")}</dt>
            <dd className={value}>
              {cvHref ? (
                <a
                  href={cvHref}
                  className="inline-block rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
                  download
                >
                  {t("cvDownload", { name: identity.cv.name })}
                </a>
              ) : (
                identity.cv.name
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
