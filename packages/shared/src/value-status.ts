/**
 * Status of one variable in one context.
 * missing: the key exists in the project but has no value in this context.
 * expired: getmyenv stops providing it. The external credential is unchanged.
 */
export type ValueStatus = "set" | "expiring_soon" | "expired" | "missing";

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** No row is missing. Expiring soon means within 7 days. Expired includes the exact expiry instant. */
export function getValueStatus(
  value:
    | { expiresAt: Date | string | null | undefined }
    | null
    | undefined,
  now: Date = new Date()
): ValueStatus {
  if (!value) return "missing";
  if (!value.expiresAt) return "set";
  const expires =
    typeof value.expiresAt === "string"
      ? new Date(value.expiresAt)
      : value.expiresAt;
  if (expires.getTime() <= now.getTime()) return "expired";
  if (expires.getTime() - now.getTime() <= EXPIRING_SOON_MS) {
    return "expiring_soon";
  }
  return "set";
}

/** Only set and expiring-soon values are handed out. Expired and missing are not. */
export function isValueProvidable(status: ValueStatus): boolean {
  return status === "set" || status === "expiring_soon";
}

export const EXPORT_WARNING =
  ".env exports contain plaintext values. Protect the file and do not commit it to source control.";
