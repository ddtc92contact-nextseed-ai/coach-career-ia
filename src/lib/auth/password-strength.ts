import { MIN_PASSPHRASE_LENGTH } from "@/lib/vault/crypto";

/** Longueur minimale du mot de passe du compte (comme l'ancienne phrase du coffre). */
export const MIN_PASSWORD_LENGTH = MIN_PASSPHRASE_LENGTH;

export type PasswordStrength = "tooShort" | "weak" | "fair" | "good" | "strong";
export const STRENGTH_LEVELS: readonly PasswordStrength[] = [
  "tooShort",
  "weak",
  "fair",
  "good",
  "strong",
];

const COMMON =
  /pass(e|word)?|mot ?de ?passe|azerty|qwert|123|abc|admin|welcome|bonjour|soleil|iloveyou/i;

/**
 * Estimation simple de la robustesse, pour guider (la seule règle bloquante
 * est la longueur minimale) : la longueur compte le plus, puis la variété
 * des caractères ; motifs connus et répétitions pénalisent.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  let score = password.length >= 20 ? 3 : password.length >= 16 ? 2 : 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password));
  if (classes.length >= 3 || /\s/.test(password.trim())) score += 1;
  const unique = new Set(password.toLowerCase()).size;
  if (COMMON.test(password) || unique < 6 || /(.)\1{3,}/.test(password)) {
    score = Math.min(score, 1);
  }
  return STRENGTH_LEVELS[Math.min(score, 4)]!;
}
