import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "../../src/config.js";
import { createMcpServer, INSTRUCTIONS } from "../../src/mcp/handlers.js";

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

describe("INSTRUCTIONS のAIエルゴノミクス必須事項 (B1-4/B1-5/B3-1/B3-3)", () => {
	it("response_group=all を案内する (ドキュメントID取得の唯一手段)", () => {
		expect(INSTRUCTIONS).toContain("response_group=all");
	});

	it("案件中心の書類作成フロー (POST /v1/projects → 空書類) を案内する", () => {
		expect(INSTRUCTIONS).toContain("POST /v1/projects");
	});

	it("正しいフィルタ名 project_no_eq を案内する (project_id は無視される)", () => {
		expect(INSTRUCTIONS).toContain("project_no_eq");
	});

	it("文書合計 total/tax は自動集計されないことを警告する", () => {
		expect(INSTRUCTIONS).toContain("total");
	});

	it("ユースケース早見表 (月次売上 = analyses) を含む", () => {
		expect(INSTRUCTIONS).toContain("/v1/analyses");
		expect(INSTRUCTIONS).toContain("report_ym_gteq");
		expect(INSTRUCTIONS).toContain("analysis_data_kbn_in[]");
	});
	it("応答形式 (envelope / concise / fields / per_page 上限) を説明する", () => {
		expect(INSTRUCTIONS).toContain('"data"');
		expect(INSTRUCTIONS).toContain("fields");
		expect(INSTRUCTIONS).toContain("per_page");
		expect(INSTRUCTIONS).toContain("100");
	});
	it("意味論 (新しい順 / 税抜 / 注記行) と validate_write を案内する", () => {
		expect(INSTRUCTIONS).toContain("新しい順");
		expect(INSTRUCTIONS).toContain("税抜");
		expect(INSTRUCTIONS).toContain("the_board_api_validate_write");
	});
	it("2,400 トークン相当 (5,300 字) 以内に収める", () => {
		expect(INSTRUCTIONS.length).toBeLessThanOrEqual(5300);
	});
});

describe("MCP prompts (B3-2)", () => {
	function promptNames(server: Awaited<ReturnType<typeof createMcpServer>>): string[] {
		return Object.keys(
			(server as unknown as { _registeredPrompts: Record<string, unknown> })._registeredPrompts,
		);
	}

	it("書類作成ガイドのプロンプトが登録される", async () => {
		const names = promptNames(await createMcpServer(getConfig([])));
		expect(names).toContain("create_project_with_documents");
	});
});

describe("ツールの条件付き登録 (Write 3段階セーフティ)", () => {
	it("read-only (default): read 系のみ登録、write ツールは非登録", async () => {
		const names = toolNames(await createMcpServer(getConfig([])));
		expect(names).toContain("the_board_api_get");
		expect(names).toContain("the_board_api_list_paths");
		expect(names).toContain("the_board_api_describe");
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

describe("the_board_api_validate_write", () => {
	it("read-only でも登録される", async () => {
		const server = await createMcpServer(getConfig([]));
		expect(toolNames(server)).toContain("the_board_api_validate_write");
	});
});
