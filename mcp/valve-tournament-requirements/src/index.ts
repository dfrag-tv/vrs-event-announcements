import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GITHUB_BLOB_URL =
  "https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/tournament-operation-requirements.md";

const RAW_URL =
  "https://raw.githubusercontent.com/ValveSoftware/counter-strike_rules_and_regs/main/tournament-operation-requirements.md";

const RESOURCE_URI = "valve://tournament-operation-requirements";

type CachedDocument = {
  text: string;
  fetchedAt: string;
  sourceUrl: string;
};

let cache: CachedDocument | null = null;

async function fetchDocument(force = false): Promise<CachedDocument> {
  if (!force && cache) {
    return cache;
  }

  const response = await fetch(RAW_URL, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "valve-tournament-requirements-mcp",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Tournament Operation Requirements: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  cache = {
    text,
    fetchedAt: new Date().toISOString(),
    sourceUrl: GITHUB_BLOB_URL,
  };

  return cache;
}

const server = new McpServer(
  {
    name: "valve-tournament-requirements",
    version: "1.0.0",
  },
  {
    instructions: [
      "Use this server to read Valve's official CS2 Tournament Operation Requirements.",
      "Prefer the resource valve://tournament-operation-requirements for the full document.",
      "Use get_tournament_operation_requirements with refresh=true when you need the latest GitHub version.",
      `Source: ${GITHUB_BLOB_URL}`,
    ].join(" "),
  },
);

server.registerResource(
  "tournament-operation-requirements",
  RESOURCE_URI,
  {
    title: "Valve Tournament Operation Requirements",
    description:
      "Official Valve CS2 Tournament Operation Requirements (VRS, invites, qualifiers, publication timing).",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const document = await fetchDocument();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: document.text,
        },
      ],
    };
  },
);

server.registerTool(
  "get_tournament_operation_requirements",
  {
    title: "Get Tournament Operation Requirements",
    description:
      "Fetches Valve's CS2 Tournament Operation Requirements from GitHub. Use for VRS compliance checks.",
    inputSchema: z.object({
      refresh: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass cache and fetch the latest version from GitHub."),
    }),
  },
  async ({ refresh }) => {
    try {
      const document = await fetchDocument(refresh);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `# Valve Tournament Operation Requirements`,
              ``,
              `- **Source:** ${document.sourceUrl}`,
              `- **Fetched at:** ${document.fetchedAt}`,
              `- **Cached:** ${refresh ? "no (refreshed)" : "yes unless first fetch"}`,
              ``,
              document.text,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown fetch error";
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in valve-tournament-requirements MCP server:", error);
  process.exit(1);
});
