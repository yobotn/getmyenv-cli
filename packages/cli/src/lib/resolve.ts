import { pcErr as pc } from "./colors.js";
import type { SealedKey } from "@getmyenv/crypto";
import { ApiClient, ApiError, type Protection } from "./api.js";
import { sleep } from "./authorize.js";
import { signMachineProof } from "./identity.js";
import type { MissingKey } from "./run-env.js";

export type ResolveOk = {
  status: "ok";
  /** How the read was allowed. */
  via: "open" | "trusted" | "auto" | "grant";
  context: { id: number; slug: string; name: string; protection: Protection };
  sealedKey: SealedKey | null;
  values: Array<{ name: string; ciphertext: string }>;
  missing: MissingKey[];
};

type ResolvePending = {
  status: "pending";
  requestId: number;
  expiresAt: string;
  reviewUrl: string;
};

const GRANT_HEADER = "X-Getmyenv-Grant";

/** Status lines go to stderr so stdout stays clean for pipes. */
const log = (line = "") => console.error(line);

export type ResolvePurpose = "run" | "export" | "push";

async function resolveOnce(
  client: ApiClient,
  projectId: string,
  slug: string,
  purpose: ResolvePurpose,
  grant?: string
): Promise<ResolveOk | ResolvePending> {
  return client.request<ResolveOk | ResolvePending>(
    "POST",
    "/api/cli/resolve",
    { context: slug, machine: signMachineProof(projectId, slug), purpose },
    grant ? { [GRANT_HEADER]: grant } : undefined
  );
}

async function waitForGrant(client: ApiClient, pending: ResolvePending): Promise<string> {
  log(`Waiting for approval in the dashboard: ${pending.reviewUrl}`);
  log(pc.dim("Trust this machine there to skip approval next time.\n"));
  const deadline = new Date(pending.expiresAt).getTime();
  while (Date.now() < deadline) {
    await sleep(1500);
    const s = await client.request<{ status: string; grantToken?: string }>(
      "GET",
      `/api/cli/requests/${pending.requestId}`
    );
    if (s.status === "approved" && s.grantToken) {
      log(`${pc.green("✓")} Approved\n`);
      return s.grantToken;
    }
    if (s.status === "approved") {
      throw new Error("This approval was already used. Run the command again.");
    }
    if (s.status === "denied") throw new Error("Access denied in the dashboard.");
    if (s.status === "expired") break;
  }
  throw new Error("Approval request expired. Run the command again.");
}

/** The server's reason, then one retry step, with one period between them. */
export function grantRefusedMessage(serverMessage: string): string {
  const reason = serverMessage.trim().replace(/[.!?\s]+$/, "");
  return reason ? `${reason}. Run the command again.` : "Run the command again.";
}

/**
 * Ciphertext for one context. Read-only contexts need a server token, an
 * allowed IP, and a trusted machine or an approval in the dashboard.
 */
export async function resolveValues(
  client: ApiClient,
  projectId: string,
  slug: string,
  purpose: ResolvePurpose
): Promise<ResolveOk> {
  let res = await resolveOnce(client, projectId, slug, purpose);
  if (res.status === "pending") {
    const grant = await waitForGrant(client, res);
    try {
      res = await resolveOnce(client, projectId, slug, purpose, grant);
    } catch (err) {
      // The grant was refused: 401 today, or the code grant_invalid.
      if (err instanceof ApiError && (err.status === 401 || err.code === "grant_invalid")) {
        throw new Error(grantRefusedMessage(err.message));
      }
      throw err;
    }
    if (res.status !== "ok") throw new Error("Approval did not complete. Run the command again.");
  }
  if (res.via === "auto") {
    log(`${pc.green("✓")} This machine is now trusted for ${res.context.slug}.`);
  }
  return res;
}
