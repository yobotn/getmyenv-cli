import { describe, expect, it } from "vitest";
import { parseSafeUrl, pickApiUrl, PRODUCTION_API, pushApiBase } from "./api-url.js";
import { browserCommand } from "./authorize.js";

describe("pickApiUrl", () => {
  it("defaults to production", () => {
    expect(pickApiUrl({})).toBe(PRODUCTION_API);
  });

  it("prefers flag, then env, then token.json", () => {
    expect(
      pickApiUrl({ override: "https://a.test", env: "https://b.test", tokenFile: "https://c.test" })
    ).toBe("https://a.test");
    expect(pickApiUrl({ env: "https://b.test/", tokenFile: "https://c.test" })).toBe("https://b.test");
    expect(pickApiUrl({ tokenFile: "https://c.test" })).toBe("https://c.test");
  });

  it("allows http only for localhost", () => {
    expect(pickApiUrl({ env: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(pickApiUrl({ env: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(() => pickApiUrl({ env: "http://evil.test" })).toThrow(/Refusing API URL/);
    expect(() => pickApiUrl({ tokenFile: "file:///etc/passwd" })).toThrow(/Refusing API URL/);
  });

  it("rejects credentials in the URL", () => {
    expect(parseSafeUrl("https://user:pw@getmyenv.com")).toBeNull();
  });
});

describe("pushApiBase", () => {
  it("keeps the platform API unless GETMYENV_PUSH_API_URL is set", () => {
    expect(pushApiBase("https://api.vercel.com", undefined)).toBe("https://api.vercel.com");
    expect(pushApiBase("https://api.vercel.com", " ")).toBe("https://api.vercel.com");
    expect(pushApiBase("https://api.vercel.com", "http://127.0.0.1:4010/")).toBe("http://127.0.0.1:4010");
  });

  it("refuses http outside localhost", () => {
    expect(() => pushApiBase("https://api.vercel.com", "http://evil.test")).toThrow(/Refusing GETMYENV_PUSH_API_URL/);
  });
});

describe("browserCommand", () => {
  const url = "https://getmyenv.com/claim#code=abc&session=def";

  it("passes the URL as one argument, no shell", () => {
    expect(browserCommand(url, "win32")).toEqual({
      cmd: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    });
    expect(browserCommand(url, "darwin")).toEqual({ cmd: "open", args: [url] });
    expect(browserCommand(url, "linux")).toEqual({ cmd: "xdg-open", args: [url] });
  });

  it("refuses non-web URLs and shell payloads", () => {
    expect(browserCommand("calc.exe", "win32")).toBeNull();
    expect(browserCommand('" & calc & "', "win32")).toBeNull();
    expect(browserCommand("file:///C:/Windows/System32/calc.exe", "win32")).toBeNull();
    expect(browserCommand("http://evil.test/x", "linux")).toBeNull();
  });

  it("encodes shell characters inside a valid URL", () => {
    const cmd = browserCommand("https://getmyenv.com/a b\"c", "linux");
    expect(cmd?.args[0]).toBe("https://getmyenv.com/a%20b%22c");
  });
});
