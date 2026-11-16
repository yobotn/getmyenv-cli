import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTS, TEMPLATE_FILE } from "@getmyenv/shared";
import type { Linked } from "../lib/bootstrap.js";

const promptHidden = vi.fn<(q: string) => Promise<string>>();
const uploadValues = vi.fn();

vi.mock("../lib/fs.js", async (orig) => ({
  ...(await orig<typeof import("../lib/fs.js")>()),
  promptHidden: (q: string) => promptHidden(q),
}));
vi.mock("../lib/upload.js", async (orig) => ({
  ...(await orig<typeof import("../lib/upload.js")>()),
  uploadValues: (...args: unknown[]) => uploadValues(...args),
}));

const { askMissingValues } = await import("./template.js");
const { startChoices } = await import("./start.js");
const { verifyUrlFor } = await import("../lib/authorize.js");

const ctx = { slug: "development" } as never;
const linked = (status: Record<string, "set" | "missing">) =>
  ({
    who: {
      keys: Object.entries(status).map(([name, s]) => ({ name, status: { development: s } })),
    },
  }) as unknown as Linked;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  promptHidden.mockReset();
  uploadValues.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askMissingValues", () => {
  it("does not ask for a value that is already set", async () => {
    promptHidden.mockResolvedValue("v");
    uploadValues.mockResolvedValue({ set: ["B"] });
    await askMissingValues([{ name: "A" }, { name: "B" }], linked({ A: "set", B: "missing" }), ctx);
    expect(promptHidden).toHaveBeenCalledTimes(1);
    expect(promptHidden.mock.calls[0]?.[0]).toContain("B");
    expect(uploadValues).toHaveBeenCalledWith(expect.objectContaining({ pairs: { B: "v" } }));
  });

  it("asks for names the project does not have yet", async () => {
    promptHidden.mockResolvedValue("");
    await askMissingValues([{ name: "NEW" }], linked({}), ctx);
    expect(promptHidden).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when Enter skips every value", async () => {
    promptHidden.mockResolvedValue("");
    await askMissingValues([{ name: "A" }, { name: "B" }], linked({ A: "missing", B: "missing" }), ctx);
    expect(promptHidden).toHaveBeenCalledTimes(2);
    expect(uploadValues).not.toHaveBeenCalled();
  });

  it("asks nothing when every value is set", async () => {
    await askMissingValues([{ name: "A" }], linked({ A: "set" }), ctx);
    expect(promptHidden).not.toHaveBeenCalled();
  });
});

describe("startChoices", () => {
  it("offers the linked project first, then a new project from the file", () => {
    const [signIn, fresh] = startChoices(
      { projectId: "p1", projectName: "Acme" },
      { keys: [{ name: "A" }, { name: "B" }] }
    );
    expect(signIn).toBe("Sign in to Acme");
    expect(fresh).toBe(`New project from ${TEMPLATE_FILE} (2 variables). ${FACTS.templateFileNewProject}`);
  });

  it("says variable for one name", () => {
    const [, fresh] = startChoices({ projectId: "p1" }, { keys: [{ name: "A" }] });
    expect(fresh).toContain("(1 variable)");
  });
});

describe("verifyUrlFor", () => {
  const base = "https://getmyenv.com/cli/auth?session=s";

  it("asks for a new project with the suggested name", () => {
    expect(verifyUrlFor(base, { newProject: { name: "My app & co" } })).toBe(
      `${base}&project=new&name=My%20app%20%26%20co`
    );
  });

  it("preselects the linked project", () => {
    expect(verifyUrlFor(base, { projectId: "p1" })).toBe(`${base}&project=p1`);
  });

  it("leaves the URL alone otherwise", () => {
    expect(verifyUrlFor(base, {})).toBe(base);
    expect(verifyUrlFor("https://x/cli/auth", { projectId: "p1" })).toBe("https://x/cli/auth?project=p1");
  });
});
