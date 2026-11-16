import { describe, expect, it } from "vitest";
import { isPublicEnvName, publicSecretWarning } from "./public-env.js";

/** A fake Stripe secret key, joined at runtime so secret scanners do not flag the source. */
const FAKE_SECRET_KEY = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");

describe("isPublicEnvName", () => {
  it("knows the framework prefixes", () => {
    expect(isPublicEnvName("NEXT_PUBLIC_API_URL")).toBe(true);
    expect(isPublicEnvName("VITE_KEY")).toBe(true);
    expect(isPublicEnvName("EXPO_PUBLIC_X")).toBe(true);
    expect(isPublicEnvName("DATABASE_URL")).toBe(false);
    expect(isPublicEnvName("PUBLICATION_ID")).toBe(false);
  });
});

describe("publicSecretWarning", () => {
  it("warns on a secret-looking value under a public name", () => {
    expect(publicSecretWarning("NEXT_PUBLIC_STRIPE_KEY", FAKE_SECRET_KEY)).toMatch(
      /exposed to the browser.*value also looks like a secret/
    );
    expect(publicSecretWarning("VITE_DB", "postgres://u:hunter2@db.example.com/app")).toMatch(/looks like a secret/);
  });

  it("warns on a public name that says it is a secret", () => {
    expect(publicSecretWarning("NEXT_PUBLIC_CLIENT_SECRET")).toMatch(/name says it is a secret/);
  });

  it("stays quiet for public values and server names", () => {
    expect(publicSecretWarning("NEXT_PUBLIC_STRIPE_KEY", "pk_live_abcdefghijklmnopqrstuvwx")).toBeNull();
    expect(publicSecretWarning("NEXT_PUBLIC_API_URL", "https://api.example.com")).toBeNull();
    expect(publicSecretWarning("STRIPE_SECRET_KEY", FAKE_SECRET_KEY)).toBeNull();
  });
});
