import type { formats } from "@/i18n/formats";
import type { Messages } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";

// Clés de traduction typées : une clé absente du français est une erreur de compilation.
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
    Formats: typeof formats;
  }
}
