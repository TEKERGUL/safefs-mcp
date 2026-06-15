import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("package manifest", () => {
  it("uses a publish whitelist that excludes source, tests, and caches", async () => {
    const raw = await fs.readFile(path.resolve("package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { files?: string[] };

    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("examples");
    expect(pkg.files).not.toContain("src");
    expect(pkg.files).not.toContain("tests");
    expect(pkg.files).not.toContain(".pnpm-store");
  });
});
