import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMcpConfigSnippet } from "../src/cli/mcpConfig.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-mcp-config-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("mcp-config", () => {
  it("prints an Antigravity snippet with an absolute project root", () => {
    const raw = createMcpConfigSnippet(tmpDir, "antigravity");
    const parsed = JSON.parse(raw) as {
      mcpServers: { safefs: { command: string; args: string[]; type?: string } };
    };

    expect(parsed.mcpServers.safefs.command).toBe("npx");
    expect(parsed.mcpServers.safefs.args).toEqual([
      "-y",
      "@tekergul/safefs-mcp",
      "serve",
      "--root",
      path.resolve(tmpDir),
    ]);
    expect(parsed.mcpServers.safefs.type).toBeUndefined();
  });
});
