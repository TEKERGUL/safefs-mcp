import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("package manifest", () => {
  it("uses a publish whitelist that excludes source, tests, and caches", async () => {
    const raw = await fs.readFile(path.resolve("package.json"), "utf-8");
    const pkg = JSON.parse(raw) as {
      files?: string[];
      version?: string;
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
      packageManager?: string;
    };

    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.repository?.url).toContain("github.com/TEKERGUL/safefs-mcp");
    expect(pkg.bugs?.url).toContain("github.com/TEKERGUL/safefs-mcp/issues");
    expect(pkg.homepage).toContain("github.com/TEKERGUL/safefs-mcp");
    expect(pkg.packageManager).toMatch(/^pnpm@/);
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("assets");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("examples");
    expect(pkg.files).not.toContain("src");
    expect(pkg.files).not.toContain("tests");
    expect(pkg.files).not.toContain(".pnpm-store");
  });
});
