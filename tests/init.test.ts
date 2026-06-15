import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runInit } from "../src/cli/init.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-init-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("init", () => {
  it("init creates .safefs/", async () => {
    await runInit(tmpDir);

    const stat = await fs.stat(path.join(tmpDir, ".safefs"));
    expect(stat.isDirectory()).toBe(true);

    const timelineDir = await fs.stat(path.join(tmpDir, ".safefs", "timeline"));
    expect(timelineDir.isDirectory()).toBe(true);

    const objectsDir = await fs.stat(path.join(tmpDir, ".safefs", "objects"));
    expect(objectsDir.isDirectory()).toBe(true);
  });

  it("init creates .safefs.yml", async () => {
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, ".safefs.yml"), "utf-8");
    expect(content).toContain("workspace:");
    expect(content).toContain("protected:");
  });

  it("init appends .safefs/ to .gitignore", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n");
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".safefs/");
  });

  it("init creates .gitignore if missing", async () => {
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain(".safefs/");
  });

  it("init is idempotent", async () => {
    await runInit(tmpDir);
    await runInit(tmpDir);

    const gitignore = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    const matches = gitignore.match(/\.safefs\//g);
    expect(matches!.length).toBe(1);
  });

  it("init creates AGENTS.md", async () => {
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("SafeFS Agent Rules");
    expect(content).toContain("safe_write");
  });

  it("init does not overwrite existing AGENTS.md", async () => {
    await fs.writeFile(path.join(tmpDir, "AGENTS.md"), "Custom rules");
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toBe("Custom rules");
  });

  it("init --yes with clients creates MCP config files", async () => {
    const result = await runInit(tmpDir, {
      yes: true,
      clients: ["codex", "cursor", "claude", "gemini"],
    });

    expect(result.clients).toEqual(["codex", "cursor", "claude", "gemini"]);
    expect(result.installMode).toBe("npm");

    const codex = await fs.readFile(path.join(tmpDir, ".codex", "config.toml"), "utf-8");
    const cursor = await fs.readFile(path.join(tmpDir, ".cursor", "mcp.json"), "utf-8");
    const claude = await fs.readFile(path.join(tmpDir, ".mcp.json"), "utf-8");
    const gemini = await fs.readFile(path.join(tmpDir, ".gemini", "settings.json"), "utf-8");

    expect(codex).toContain("safe_diff");
    expect(cursor).toContain("@tekergul/safefs-mcp");
    expect(claude).toContain("@tekergul/safefs-mcp");
    expect(gemini).toContain("\"mcpServers\"");
    expect(gemini).toContain("\"safefs\"");
  });

  it("init --local writes MCP configs that run the local CLI", async () => {
    const localCliPath = path.join(tmpDir, "dist", "cli.js");
    const result = await runInit(tmpDir, {
      yes: true,
      local: true,
      localCliPath,
      clients: ["codex", "gemini"],
    });

    expect(result.installMode).toBe("local");

    const codex = await fs.readFile(path.join(tmpDir, ".codex", "config.toml"), "utf-8");
    const gemini = await fs.readFile(path.join(tmpDir, ".gemini", "settings.json"), "utf-8");

    expect(codex).toContain('command = "node"');
    expect(codex).toContain(JSON.stringify(localCliPath));
    expect(codex).not.toContain("@tekergul/safefs-mcp");

    const geminiConfig = JSON.parse(gemini) as {
      mcpServers: { safefs: { command: string; args: string[] } };
    };
    expect(geminiConfig.mcpServers.safefs.command).toBe("node");
    expect(geminiConfig.mcpServers.safefs.args[0]).toBe(localCliPath);
    expect(gemini).not.toContain("@tekergul/safefs-mcp");
  });

  it("init does not overwrite existing MCP config files", async () => {
    await fs.mkdir(path.join(tmpDir, ".cursor"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".cursor", "mcp.json"), "custom");

    await runInit(tmpDir, {
      yes: true,
      clients: ["cursor"],
    });

    const content = await fs.readFile(path.join(tmpDir, ".cursor", "mcp.json"), "utf-8");
    expect(content).toBe("custom");
  });
});
