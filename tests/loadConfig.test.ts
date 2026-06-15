import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config/loadConfig.js";
import { SafeFSError } from "../src/types/index.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-config-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should return default config if no .safefs.yml exists", async () => {
    const config = await loadConfig(tmpDir);
    expect(config.protected).toContain(".safefs/**");
    expect(config.protected).toContain(".git/**");
  });

  it("should parse a valid .safefs.yml", async () => {
    const yamlContent = `
protectedPaths:
  - ".env"
  - "secrets/**"
`;
    await fs.writeFile(path.join(tmpDir, ".safefs.yml"), yamlContent);
    const config = await loadConfig(tmpDir);
    expect(config.protected).toContain(".env");
    expect(config.protected).toContain("secrets/**");
  });

  it("should throw INVALID_CONFIG for malformed YAML", async () => {
    const badYaml = `
protectedPaths:
  - ".env"
  invalid_yaml: [
`;
    await fs.writeFile(path.join(tmpDir, ".safefs.yml"), badYaml);
    
    try {
      await loadConfig(tmpDir);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFSError);
      expect((err as SafeFSError).code).toBe("INVALID_CONFIG");
    }
  });
});
