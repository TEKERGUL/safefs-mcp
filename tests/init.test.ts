import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runInit } from "../src/cli/init.js";
import { expectDefined } from "./helpers.js";

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
    expect(matches ?? []).toHaveLength(1);
  });

  it("init creates AGENTS.md", async () => {
    await runInit(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("SafeFS Agent Rules");
    expect(content).toContain("guard/watch mode");
    expect(content).toContain("safe_diff");
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
    expect(codex).not.toContain("safe_write");
    expect(cursor).toContain("@tekergul/safefs-mcp");
    expect(claude).toContain("@tekergul/safefs-mcp");
    expect(gemini).toContain("\"mcpServers\"");
    expect(gemini).toContain("\"safefs\"");
  });

  it("init accepts Antigravity without writing a fake project-local config", async () => {
    const result = await runInit(tmpDir, {
      yes: true,
      clients: ["antigravity"],
    });

    expect(result.clients).toEqual(["antigravity"]);
    await expect(fs.stat(path.join(tmpDir, ".gemini", "settings.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(tmpDir, ".gemini", "config", "mcp_config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("init --auto-guard creates wrappers and activation files", async () => {
    const result = await runInit(tmpDir, {
      yes: true,
      clients: ["claude"],
      autoGuard: true,
    });

    expect(result.autoGuard).toBeDefined();
    const autoGuard = expectDefined(result.autoGuard);
    expect(autoGuard.created).toContain(path.join(".safefs", "bin", "claude"));
    expect(autoGuard.created).toContain(path.join(".safefs", "bin", "claude.cmd"));
    await expect(fs.stat(path.join(tmpDir, ".safefs", "activate.ps1"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tmpDir, ".safefs", "activate.sh"))).resolves.toBeTruthy();
  });

  it("init --auto-guard skips Antigravity wrappers and installs only wrapper-capable clients", async () => {
    const result = await runInit(tmpDir, {
      yes: true,
      clients: ["claude", "antigravity"],
      autoGuard: true,
    });

    expect(result.autoGuard).toBeDefined();
    const autoGuard = expectDefined(result.autoGuard);
    expect(autoGuard.clients).toEqual(["claude"]);
    expect(autoGuard.created).toContain(path.join(".safefs", "bin", "claude"));
    expect(autoGuard.created).not.toContain(path.join(".safefs", "bin", "antigravity"));
    await expect(fs.stat(path.join(tmpDir, ".safefs", "bin", "antigravity"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("init --local auto-guard wrappers call the CLI entrypoint, not the MCP server", async () => {
    const localCliPath = path.join(tmpDir, "dist", "cli.js");
    await runInit(tmpDir, {
      yes: true,
      local: true,
      localCliPath,
      clients: ["claude"],
      autoGuard: true,
    });

    const wrapper = await fs.readFile(path.join(tmpDir, ".safefs", "bin", "claude.cmd"), "utf-8");

    expect(wrapper).toContain("node");
    expect(wrapper).toContain(localCliPath);
    expect(wrapper).toContain("auto-guard run claude --");
    expect(wrapper).not.toContain("serve --root");
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
