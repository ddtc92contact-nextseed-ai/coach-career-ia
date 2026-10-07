import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { EmailConfig } from "next-auth/providers";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { magicLinkLocale, sendMagicLink } from "@/lib/auth/mailer";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/routing";

const MAGIC_LINK_MAX_AGE = 15 * 60; // 15 minutes

// Configuration résolue à la requête : le build ne lit aucun secret.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = serverEnv();

  const magicLink: EmailConfig = {
    id: "email",
    type: "email",
    name: "E-mail",
    from: env.EMAIL_FROM,
    maxAge: MAGIC_LINK_MAX_AGE,
    options: {},
    // Langue de l'e-mail : celle de la page où le lien a été demandé, sinon la
    // préférence du compte, sinon le français.
    sendVerificationRequest: async ({ identifier, url, expires }) => {
      let locale = magicLinkLocale(url);
      if (!locale) {
        const user = await db.user.findUnique({
          where: { email: identifier },
          select: { locale: true },
        });
        locale = isAppLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
      }
      await sendMagicLink({ to: identifier, url, expires, locale });
    },
  };

  return {
    adapter: PrismaAdapter(db),
    providers: [magicLink],
    secret: env.AUTH_SECRET,
    // Derrière Traefik : l'hôte vient des en-têtes X-Forwarded-* du proxy.
    trustHost: true,
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    pages: {
      signIn: "/connexion",
      verifyRequest: "/connexion/verifier",
      error: "/connexion/erreur",
    },
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      signIn: ({ user }) => logger.info("auth.sign_in", { userId: user.id }),
      signOut: (message) =>
        logger.info("auth.sign_out", {
          userId: "session" in message && message.session ? message.session.userId : undefined,
        }),
    },
    // Les journaux d'Auth.js passent par notre logger (filtrage des données personnelles).
    logger: {
      error: (error) => logger.error("auth.error", { error }),
      warn: (code) => logger.warn("auth.warning", { code }),
      debug: () => {},
    },
  };
});
