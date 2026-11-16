/**
 * Personal and device data we store, as the privacy page shows it.
 * `scripts/check-privacy.mjs` compares `fields` with apps/web/prisma/schema.prisma:
 * a personal field in the schema must be listed here, and every listed field
 * must exist. Entries are "Model.field".
 */
export type PrivacyItem = { text: string; fields: readonly string[] };

export const PRIVACY_DATA = {
  account: [
    {
      text: "Email, and an optional name from Settings, GitHub, or Google.",
      fields: ["User.email", "User.name"],
    },
    {
      text: "An optional GitHub or Google link, with the email that provider shares.",
      fields: ["OAuthIdentity.email"],
    },
    { text: "Session tokens.", fields: [] },
    { text: "The email each login code is sent to.", fields: ["EmailOtp.email"] },
    { text: "Emails you invite to a project.", fields: ["ProjectInvite.email"] },
  ],
  network: [
    {
      text: "IP address, country, and user agent on browser sessions, tokens, and security events.",
      fields: [
        "Session.ip",
        "Session.country",
        "Session.userAgent",
        "Token.ip",
        "Token.country",
        "Token.userAgent",
        "SecurityEvent.ip",
        "SecurityEvent.country",
        "SecurityEvent.userAgent",
      ],
    },
    {
      text: "IP address and user agent when a guest project is created.",
      fields: ["Project.guestCreatedIp", "Project.guestCreatedUserAgent"],
    },
    { text: "Country on activity events.", fields: ["ActivityEvent.country"] },
    {
      text: "The IP of a server token read refused by its allowlist, on that activity event. The project owner sees it in Activity.",
      fields: [],
    },
    { text: "The country your account signed up from.", fields: ["User.signupCountry"] },
    { text: "The user agent of each remembered browser.", fields: ["TrustedDevice.userAgent"] },
    {
      text: "The name of each passkey. It starts as the browser and system it was added on, and you can rename it.",
      fields: ["Passkey.name"],
    },
    {
      text: "The IP or CIDR allowlist you set on a server token.",
      fields: ["Token.allowedCidrs"],
    },
  ],
} as const satisfies Record<string, readonly PrivacyItem[]>;

/**
 * "Last updated" for each legal page, as YYYY-MM-DD. The hash covers the page
 * source (and PRIVACY_DATA for privacy). `pnpm check:privacy` fails when the
 * content changes and the date and hash do not, and prints the new hash.
 */
export const LEGAL_PAGES = {
  privacy: {
    path: "apps/web/src/app/privacy/page.tsx",
    updated: "2026-11-16",
    hash: "36c55a4509d79727",
  },
  terms: {
    path: "apps/web/src/app/terms/page.tsx",
    updated: "2026-11-16",
    hash: "13a8ba2cbf175475",
  },
} as const;

export type LegalPage = keyof typeof LEGAL_PAGES;

/** "October 1, 2026" for a legal page. */
export function legalUpdatedLabel(page: LegalPage): string {
  return new Date(`${LEGAL_PAGES[page].updated}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
