import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "../../src/config.js";
import { createMcpServer } from "../../src/mcp/handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(await readFile(join(__dirname, "../../package.json"), "utf-8")) as {
	name: string;
	version: string;
};

describe("createMcpServer()", () => {
	it("McpServer インスタンスを返すこと", async () => {
		const server = await createMcpServer(getConfig([]));
		expect(server).toBeInstanceOf(McpServer);
	});

	it('server の name が "the-board-mcp-server" であること', async () => {
		const server = await createMcpServer(getConfig([]));
		const serverInfo = (server.server as unknown as { _serverInfo: { name: string } })._serverInfo;
		expect(serverInfo.name).toBe("the-board-mcp-server");
	});

	it("server の version が package.json の version と一致すること", async () => {
		const server = await createMcpServer(getConfig([]));
		const serverInfo = (server.server as unknown as { _serverInfo: { version: string } })
			._serverInfo;
		expect(serverInfo.version).toBe(pkg.version);
	});
});

function toolNames(server: Awaited<ReturnType<typeof createMcpServer>>): string[] {
	return Object.keys(
		(server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
	);
}

describe("ツールの条件付き登録 (Write 3段階セーフティ)", () => {
	it("read-only (default): read 系のみ登録、write ツールは非登録", async () => {
		const names = toolNames(await createMcpServer(getConfig([])));
		expect(names).toContain("the_board_api_get");
		expect(names).toContain("the_board_api_list_paths");
		expect(names).toContain("the_board_auth_status");
		expect(names).not.toContain("the_board_api_post");
		expect(names).not.toContain("the_board_api_patch");
		expect(names).not.toContain("the_board_api_delete");
	});

	it("--enable-writes: post/patch は登録、delete は非登録", async () => {
		const names = toolNames(await createMcpServer(getConfig(["--enable-writes"])));
		expect(names).toContain("the_board_api_post");
		expect(names).toContain("the_board_api_patch");
		expect(names).not.toContain("the_board_api_delete");
	});

	it("--enable-destructive-writes: delete も登録", async () => {
		const names = toolNames(await createMcpServer(getConfig(["--enable-destructive-writes"])));
		expect(names).toContain("the_board_api_post");
		expect(names).toContain("the_board_api_patch");
		expect(names).toContain("the_board_api_delete");
	});
});
