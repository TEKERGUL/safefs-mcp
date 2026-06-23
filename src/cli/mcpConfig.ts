import path from "node:path";

const PACKAGE_NAME = "@tekergul/safefs-mcp";

export type McpConfigClient = "antigravity";

export function createMcpConfigSnippet(root: string, client: McpConfigClient): string {
  switch (client) {
    case "antigravity":
      return createAntigravityMcpConfig(root);
  }
}

export function isMcpConfigClient(value: string): value is McpConfigClient {
  return value === "antigravity";
}

function createAntigravityMcpConfig(root: string): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        safefs: {
          command: "npx",
          args: ["-y", PACKAGE_NAME, "serve", "--root", path.resolve(root)],
        },
      },
    },
    null,
    2
  )}\n`;
}
