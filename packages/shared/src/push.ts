/**
 * `push vercel|netlify`: platforms the CLI copies a context to with the
 * user's own token. A push record only says what getmyenv last pushed.
 */
export const PUSH_PROVIDERS = ["vercel", "netlify"] as const;
export type PushProvider = (typeof PUSH_PROVIDERS)[number];

export const PUSH_PROVIDER_TITLES: Record<PushProvider, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
};

/** Vercel environments and Netlify deploy contexts a push can target. */
export const PUSH_PROVIDER_TARGETS: Record<PushProvider, readonly string[]> = {
  vercel: ["production", "preview", "development"],
  netlify: ["production", "deploy-preview", "branch-deploy", "dev"],
};

export const PUSH_TOKEN_ENV: Record<PushProvider, string> = {
  vercel: "VERCEL_TOKEN",
  netlify: "NETLIFY_AUTH_TOKEN",
};

const AWS_LAMBDA_RESERVED = [
  "AWS_ACCESS_KEY_ID",
  "AWS_DEFAULT_REGION",
  "AWS_EXECUTION_ENV",
  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_LAMBDA_LOG_GROUP_NAME",
  "AWS_LAMBDA_LOG_STREAM_NAME",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "LAMBDA_RUNTIME_DIR",
  "LAMBDA_TASK_ROOT",
  "TZ",
];

const RESERVED: Record<PushProvider, { prefix: string; names: Set<string> }> = {
  vercel: {
    prefix: "VERCEL_",
    names: new Set([...AWS_LAMBDA_RESERVED, "AWS_SECRET_KEY", "NOW_REGION"]),
  },
  netlify: {
    prefix: "NETLIFY_",
    names: new Set([
      ...AWS_LAMBDA_RESERVED,
      "BRANCH",
      "BUILD_ID",
      "CACHED_COMMIT_REF",
      "COMMIT_REF",
      "CONTEXT",
      "DEPLOY_ID",
      "DEPLOY_PRIME_URL",
      "DEPLOY_URL",
      "HEAD",
      "INCOMING_HOOK_BODY",
      "INCOMING_HOOK_TITLE",
      "INCOMING_HOOK_URL",
      "PULL_REQUEST",
      "REPOSITORY_URL",
      "REVIEW_ID",
      "SITE_ID",
      "SITE_NAME",
      "URL",
    ]),
  },
};

/** Names the platform sets itself or refuses. Push never writes or prunes them. */
export function isReservedPushName(provider: PushProvider, name: string): boolean {
  const r = RESERVED[provider];
  return name.startsWith(r.prefix) || r.names.has(name);
}

/** Slugs and names as the platforms issue them. Links are built from these only. */
export const PUSH_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Environment variable settings page on the platform. Fixed hosts only. */
export function pushDestinationUrl(provider: PushProvider, ownerSlug: string, externalName: string): string | null {
  if (!PUSH_SLUG_RE.test(externalName) || (provider === "vercel" && !PUSH_SLUG_RE.test(ownerSlug))) return null;
  if (provider === "vercel") {
    return `https://vercel.com/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(externalName)}/settings/environment-variables`;
  }
  return `https://app.netlify.com/sites/${encodeURIComponent(externalName)}/configuration/env`;
}

export function pushTargetLabel(target: string): string {
  const words = target.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Vercel acme/web (Production)". */
export function describePushDestination(d: {
  provider: PushProvider;
  ownerSlug: string;
  externalName: string;
  target: string;
}): string {
  return `${PUSH_PROVIDER_TITLES[d.provider]} ${d.ownerSlug}/${d.externalName} (${pushTargetLabel(d.target)})`;
}
