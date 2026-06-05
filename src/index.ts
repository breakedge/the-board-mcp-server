#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { createMcpServer } from "./mcp/handlers.js";

async function main(): Promise<void> {
	const config = getConfig();
	const server = await createMcpServer(config);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error: unknown) => {
	console.error("Failed to start server:", error);
	process.exit(1);
});
