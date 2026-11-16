import { describe, expect, it } from "vitest";
import { TOKEN_KINDS } from "./constants.js";
import {
  ENDED_TOKEN_CAUSES,
  ENDED_TOKEN_REASONS,
  endedTokenMessage,
  expiredTokenMessage,
  isEndedTokenReason,
} from "./ended-tokens.js";
import { FACTS } from "./facts.js";

const UNLINK = "Run: npx getmyenv unlink, then npx getmyenv";
const NEW_SERVER_TOKEN = "Create a new server token in Project settings, Tokens.";
const REMOVE_SERVER_TOKEN = "Remove GETMYENV_TOKEN from this server.";
const PROJECT_GONE = new Set(["project_deleted", "guest_purged", "account_deleted"]);

describe("endedTokenMessage", () => {
  it("gives every reason and kind one message, ending with the next step", () => {
    for (const reason of ENDED_TOKEN_REASONS) {
      for (const kind of TOKEN_KINDS) {
        const msg = endedTokenMessage({ reason, kind, projectName: "my-app" });
        const step =
          kind !== "server" ? UNLINK : PROJECT_GONE.has(reason) ? REMOVE_SERVER_TOKEN : NEW_SERVER_TOKEN;
        expect(msg.endsWith(step)).toBe(true);
      }
    }
  });

  it("does not offer a new server token when the project is gone", () => {
    for (const reason of PROJECT_GONE) {
      const msg = endedTokenMessage({ reason: reason as never, kind: "server", projectName: "my-app" });
      expect(msg).not.toContain("Create a new server token");
      expect(msg).toContain(REMOVE_SERVER_TOKEN);
    }
  });

  it("names the project and says the values are no longer available", () => {
    const msg = endedTokenMessage({ reason: "project_deleted", kind: "folder", projectName: "my-app" });
    expect(msg).toContain('The project "my-app" was deleted. Its values are no longer available.');
    expect(msg).toContain(FACTS.templateFileRecovery);
  });

  it("leaves the template file hint out for server tokens", () => {
    const msg = endedTokenMessage({ reason: "project_deleted", kind: "server", projectName: "my-app" });
    expect(msg).not.toContain(FACTS.templateFileRecovery);
  });

  it("names the token kind when revoked", () => {
    expect(endedTokenMessage({ reason: "revoked", kind: "server", projectName: "a" })).toContain(
      "This server token"
    );
    expect(endedTokenMessage({ reason: "revoked", kind: "folder", projectName: "a" })).toContain(
      "This folder token"
    );
  });
});

describe("expiredTokenMessage", () => {
  it("gives the date and the next step", () => {
    const msg = expiredTokenMessage({ kind: "folder", expiresAt: new Date("2026-10-07T12:00:00Z") });
    expect(msg).toBe(`This folder token expired on 2026-10-07. ${UNLINK}`);
  });
});

describe("reasons", () => {
  it("has a docs line for every reason", () => {
    for (const reason of ENDED_TOKEN_REASONS) expect(ENDED_TOKEN_CAUSES[reason]).toBeTruthy();
  });

  it("recognizes stored reasons only", () => {
    expect(isEndedTokenReason("project_deleted")).toBe(true);
    expect(isEndedTokenReason("vault_reset")).toBe(false);
  });
});
