import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  GITHUB_BLOB_URL,
  formatDocument,
  formatStatus,
  getDocument,
  getStatus,
  searchDocument,
} from "./tor.js";

const RESOURCE_URI = "valve://tournament-operation-requirements";

const server = new McpServer(
  {
    name: "valve-tournament-requirements",
    version: "1.1.0",
  },
  {
    instructions: [
      "Use this server to read Valve's official CS2 Tournament Operation Requirements.",
      "Lookups use a local copy plus the GitHub blob SHA. Do not refetch on every check.",
      "Prefer get_tournament_operation_requirements_status to compare SHAs.",
      "Prefer query= on get_tournament_operation_requirements to pull matching sections.",
      "Use refresh=true only when you need to check GitHub for a newer SHA.",
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
      "Local copy of Valve's CS2 Tournament Operation Requirements, keyed by GitHub blob SHA.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const document = await getDocument();
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
      "Returns the local TOR copy. Use query to extract matching sections. Use refresh=true only to check the GitHub SHA and update if it changed.",
    inputSchema: z.object({
      refresh: z
        .boolean()
        .optional()
        .default(false)
        .describe("Compare the GitHub blob SHA and download only if the local copy is stale."),
      query: z
        .string()
        .optional()
        .describe("Optional case-insensitive search. Returns matching TOR sections instead of the full document."),
    }),
  },
  async ({ refresh, query }) => {
    try {
      const document = await getDocument(refresh);

      if (query?.trim()) {
        const hits = searchDocument(document.text, query);
        const body =
          hits.length > 0
            ? hits.map((hit) => `## ${hit.heading}\n\n${hit.text}`).join("\n\n")
            : `No TOR sections matched \`${query.trim()}\`.`;

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `# Valve Tournament Operation Requirements search`,
                ``,
                `- **Query:** ${query.trim()}`,
                `- **Matches:** ${hits.length}`,
                `- **SHA:** ${document.sha}`,
                `- **Cache:** ${document.source === "local" ? "local copy" : "downloaded from GitHub"}`,
                document.warning ? `- **Warning:** ${document.warning}` : "",
                ``,
                body,
              ]
                .filter((line) => line !== "")
                .join("\n"),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatDocument(document),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch error";
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "get_tournament_operation_requirements_status",
  {
    title: "Get TOR cache status",
    description:
      "Returns the local TOR SHA without the full document. Use refresh=true to compare against GitHub and update the local copy only if the SHA changed.",
    inputSchema: z.object({
      refresh: z
        .boolean()
        .optional()
        .default(false)
        .describe("Check GitHub's blob SHA and update the local copy only if it differs."),
    }),
  },
  async ({ refresh }) => {
    try {
      const status = await getStatus(refresh);
      return {
        content: [{ type: "text" as const, text: formatStatus(status) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown status error";
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
