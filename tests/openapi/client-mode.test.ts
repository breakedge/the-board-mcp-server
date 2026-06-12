import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config.js";
import {
	handleAuthStatus,
	handleDelete,
	handleDescribe,
	handleGet,
	handleListPaths,
	handlePatch,
	handlePost,
} from "../../src/openapi/client-mode.js";
import { loadSchema } from "../../src/openapi/schema-loader.js";
import type { MinimalSchema } from "../../src/openapi/types.js";

const TEST_BASE_URL = "https://api.the-board.jp";
const mswServer = setupServer();

let schema: MinimalSchema;

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		readOnly: true,
		enableWrites: false,
		enableDestructiveWrites: false,
		toolsets: [
			"projects",
			"documents",
			"customers",
			"payees",
			"expenditures",
			"master",
			"analytics",
		],
		...overrides,
	};
}

beforeAll(async () => {
	mswServer.listen({ onUnhandledRequest: "error" });
	schema = await loadSchema();
});

beforeEach(() => {
	vi.stubEnv("THE_BOARD_API_KEY", "test-key");
	vi.stubEnv("THE_BOARD_API_TOKEN", "test-token");
});

afterEach(() => {
	mswServer.resetHandlers();
	vi.unstubAllEnvs();
});

afterAll(() => {
	mswServer.close();
});

// ---------------------------------------------------------------------------
// handleListPaths (STEP 2-3)
// ---------------------------------------------------------------------------
describe("handleListPaths", () => {
	it("引数なしで全エンドポイントを返す", () => {
		const result = handleListPaths({}, makeConfig(), schema);
		expect(result.content[0].type).toBe("text");
		const text = result.content[0].text as string;
		const parsed = JSON.parse(text);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBeGreaterThan(0);
		expect(parsed[0]).toHaveProperty("method");
		expect(parsed[0]).toHaveProperty("path");
		expect(parsed[0]).toHaveProperty("summary");
	});

	it("method='GET' で GET のみフィルタ", () => {
		const result = handleListPaths({ method: "GET" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.every((e: { method: string }) => e.method === "GET")).toBe(true);
	});

	it("keyword='client' でパス/summaryに 'client' を含むもの", () => {
		const result = handleListPaths({ keyword: "client" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.length).toBeGreaterThan(0);
		expect(
			parsed.every(
				(e: { path: string; summary: string }) =>
					e.path.toLowerCase().includes("client") ||
					e.summary.toLowerCase().includes("client") ||
					e.summary.includes("顧客"),
			),
		).toBe(true);
	});

	it("method + keyword の組み合わせ", () => {
		const result = handleListPaths({ method: "POST", keyword: "client" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.every((e: { method: string }) => e.method === "POST")).toBe(true);
	});

	it("toolsets で有効ドメインのみに絞る (--toolsets projects)", () => {
		const result = handleListPaths({}, makeConfig({ toolsets: ["projects"] }), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.length).toBeGreaterThan(0);
		// projects ドメイン (/v1/projects*, /v1/project_costs*) のパスのみ
		expect(parsed.every((e: { path: string }) => e.path.startsWith("/v1/project"))).toBe(true);
		// documents ドメインのパスは含まれない
		expect(parsed.some((e: { path: string }) => e.path.startsWith("/v1/documents"))).toBe(false);
	});

	it("parameters を持つエンドポイントは出力に parameters を含む (B1-3)", () => {
		const result = handleListPaths({ method: "GET", keyword: "projects" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		const projects = parsed.find(
			(e: { path: string; method: string }) => e.path === "/v1/projects" && e.method === "GET",
		);
		expect(projects).toBeDefined();
		expect(Array.isArray(projects.parameters)).toBe(true);
		expect(projects.parameters.map((p: { name: string }) => p.name)).toContain("project_no_eq");
	});

	it("parameters を持たないエンドポイントには parameters を付けない (B1-3)", () => {
		const result = handleListPaths({ method: "POST", keyword: "client" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		const post = parsed.find((e: { path: string }) => e.path === "/v1/clients");
		expect(post).toBeDefined();
		expect(post.parameters).toBeUndefined();
	});

	it("list_paths のパラメータは軽量で enum/description を含めない (B1-3 lean)", () => {
		// 詳細(enum/説明)は describe で取得する。discovery 出力は軽量に保つ。
		const result = handleListPaths({ method: "GET", keyword: "projects" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		const projects = parsed.find(
			(e: { path: string; method: string }) => e.path === "/v1/projects" && e.method === "GET",
		);
		const rg = projects.parameters.find((p: { name: string }) => p.name === "response_group");
		expect(rg.type).toBe("string");
		expect(rg.enum).toBeUndefined();
		expect(rg.description).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// handleDescribe (B1-2)
// ---------------------------------------------------------------------------
describe("handleDescribe", () => {
	it("GET のクエリパラメータを enum/説明込みで返す", () => {
		const result = handleDescribe({ path: "/v1/projects", method: "GET" }, makeConfig(), schema);
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text as string);
		const rg = parsed.parameters.find((p: { name: string }) => p.name === "response_group");
		expect(rg.enum).toContain("all");
	});

	it("PATCH の requestBody フィールド(details[] と enum)を返す", () => {
		const result = handleDescribe(
			{ path: "/v1/documents/estimates/1", method: "PATCH" },
			makeConfig(),
			schema,
		);
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text as string);
		const details = parsed.requestBody.properties.find(
			(p: { name: string }) => p.name === "details",
		);
		const kbn = details.items.properties.find(
			(p: { name: string }) => p.name === "document_detail_kbn",
		);
		expect(kbn.enum).toEqual([1, 2, 3]);
	});

	it("存在しない path/method は isError", () => {
		const result = handleDescribe({ path: "/v1/nonexistent", method: "GET" }, makeConfig(), schema);
		expect(result.isError).toBe(true);
	});

	it("無効な toolset の path は isError", () => {
		const result = handleDescribe(
			{ path: "/v1/clients", method: "GET" },
			makeConfig({ toolsets: ["projects"] }),
			schema,
		);
		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handleGet (STEP 2-4)
// ---------------------------------------------------------------------------
describe("handleGet", () => {
	it("正常系: /v1/clients → JSON テキスト返却", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json([{ id: 1 }]);
			}),
		);
		const config = makeConfig();
		const result = await handleGet({ path: "/v1/clients" }, config, schema);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain('"id"');
	});

	it("query オブジェクト渡し", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, ({ request }) => {
				const url = new URL(request.url);
				expect(url.searchParams.get("page")).toBe("1");
				return HttpResponse.json([]);
			}),
		);
		const config = makeConfig();
		await handleGet({ path: "/v1/projects", query: { page: 1 } }, config, schema);
	});

	it("無効パス → エラーレスポンス", async () => {
		const config = makeConfig();
		const result = await handleGet({ path: "/v1/nonexistent" }, config, schema);
		expect(result.isError).toBe(true);
	});

	it("readOnly モードで GET は許可", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/clients`, () => HttpResponse.json([])));
		const config = makeConfig({ readOnly: true });
		const result = await handleGet({ path: "/v1/clients" }, config, schema);
		expect(result.isError).toBeUndefined();
	});

	it("API エラー (404) → isError: true", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients/999`, () => {
				return HttpResponse.json({ message: "Not Found" }, { status: 404 });
			}),
		);
		const config = makeConfig();
		const result = await handleGet({ path: "/v1/clients/999" }, config, schema);
		expect(result.isError).toBe(true);
	});

	it("無効な toolset のパスは拒否される", async () => {
		// /v1/clients は customers ドメイン。toolsets=projects のみなら拒否。
		const config = makeConfig({ toolsets: ["projects"] });
		const result = await handleGet({ path: "/v1/clients" }, config, schema);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("toolset");
	});

	it("未知のクエリパラメータ → isError + 有効パラメータ一覧を提示 (B0-1)", async () => {
		// project_id は board では無視される。正解は project_no_eq。
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/projects", query: { project_id: 123 } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("project_id");
		expect(result.content[0].text).toContain("project_no_eq");
	});

	it("パラメータ定義の無いエンドポイントは未知キーでも通す (fail-open, B0-1)", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/clients/1`, () => HttpResponse.json({ id: 1 })));
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/clients/1", query: { anything: "x" } },
			config,
			schema,
		);
		expect(result.isError).toBeUndefined();
	});

	it("既知パラメータ (page) は拒否されない (B0-1 偽陽性防止)", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/projects`, () => HttpResponse.json([])));
		const config = makeConfig();
		const result = await handleGet({ path: "/v1/projects", query: { page: 1 } }, config, schema);
		expect(result.isError).toBeUndefined();
	});

	it("query 値にオブジェクトを渡すと API に送らず isError (B0-4)", async () => {
		// 200 を返すハンドラを登録: 検証が無ければ [object Object] として送られ成功してしまう。
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/projects`, () => HttpResponse.json([])));
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/projects", query: { "tags[]": { nested: 1 } } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("オブジェクト");
	});
});

// ---------------------------------------------------------------------------
// handlePost (STEP 2-5)
// ---------------------------------------------------------------------------
describe("handlePost", () => {
	it("正常系: enableWrites=true", async () => {
		mswServer.use(
			http.post(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json({ id: 1 }, { status: 201 });
			}),
		);
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePost(
			{ path: "/v1/clients", body: { name: "Test" } },
			config,
			schema,
		);
		expect(result.isError).toBeUndefined();
	});

	it("無効な toolset のパスは拒否される (writes 有効でも)", async () => {
		const config = makeConfig({
			readOnly: false,
			enableWrites: true,
			toolsets: ["projects"],
		});
		const result = await handlePost(
			{ path: "/v1/clients", body: { name: "Test" } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("toolset");
	});

	it("readOnly モード → エラー + 有効化方法", async () => {
		const config = makeConfig({ readOnly: true });
		const result = await handlePost(
			{ path: "/v1/clients", body: { name: "Test" } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("--enable-writes");
	});

	it("enableWrites=false → エラー", async () => {
		const config = makeConfig({ readOnly: false, enableWrites: false });
		const result = await handlePost(
			{ path: "/v1/clients", body: { name: "Test" } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
	});

	it("無効パス → エラー", async () => {
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePost({ path: "/v1/nonexistent", body: {} }, config, schema);
		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handlePatch (STEP 2-6)
// ---------------------------------------------------------------------------
describe("handlePatch", () => {
	it("正常系: enableWrites=true", async () => {
		mswServer.use(
			http.patch(`${TEST_BASE_URL}/v1/clients/1`, () => {
				return HttpResponse.json({ id: 1 });
			}),
		);
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePatch(
			{ path: "/v1/clients/1", body: { name: "Updated" } },
			config,
			schema,
		);
		expect(result.isError).toBeUndefined();
	});

	it("readOnly → エラー", async () => {
		const config = makeConfig({ readOnly: true });
		const result = await handlePatch({ path: "/v1/clients/1", body: {} }, config, schema);
		expect(result.isError).toBe(true);
	});

	it("204 No Content の書き込みは成功マーカーを返す (リテラル null にしない, B2-4)", async () => {
		mswServer.use(
			http.patch(`${TEST_BASE_URL}/v1/clients/1`, () => new HttpResponse(null, { status: 204 })),
		);
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePatch(
			{ path: "/v1/clients/1", body: { name: "x" } },
			config,
			schema,
		);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).not.toBe("null");
		expect(result.content[0].text).toContain("success");
	});

	it("destructive パス (lock_flg) + enableDestructiveWrites=false → エラー", async () => {
		const config = makeConfig({
			readOnly: false,
			enableWrites: true,
			enableDestructiveWrites: false,
		});
		const result = await handlePatch({ path: "/v1/projects/lock_flg/1", body: {} }, config, schema);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("--enable-destructive-writes");
	});

	it("destructive パス (lock_flg) + enableDestructiveWrites=true → 許可", async () => {
		mswServer.use(
			http.patch(`${TEST_BASE_URL}/v1/projects/lock_flg/1`, () => {
				return HttpResponse.json({ locked: true });
			}),
		);
		const config = makeConfig({
			readOnly: false,
			enableWrites: true,
			enableDestructiveWrites: true,
		});
		const result = await handlePatch({ path: "/v1/projects/lock_flg/1", body: {} }, config, schema);
		expect(result.isError).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// handleDelete (STEP 2-6)
// ---------------------------------------------------------------------------
describe("handleDelete", () => {
	it("正常系: enableDestructiveWrites=true", async () => {
		mswServer.use(
			http.delete(`${TEST_BASE_URL}/v1/clients/1`, () => {
				return new HttpResponse(null, { status: 204 });
			}),
		);
		const config = makeConfig({
			readOnly: false,
			enableWrites: true,
			enableDestructiveWrites: true,
		});
		const result = await handleDelete({ path: "/v1/clients/1" }, config, schema);
		expect(result.isError).toBeUndefined();
	});

	it("enableDestructiveWrites=false → エラー + 有効化方法", async () => {
		const config = makeConfig({
			readOnly: false,
			enableWrites: true,
			enableDestructiveWrites: false,
		});
		const result = await handleDelete({ path: "/v1/clients/1" }, config, schema);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("--enable-destructive-writes");
	});

	it("readOnly → エラー", async () => {
		const config = makeConfig({ readOnly: true });
		const result = await handleDelete({ path: "/v1/clients/1" }, config, schema);
		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handleAuthStatus (STEP 2-7)
// ---------------------------------------------------------------------------
describe("handleAuthStatus", () => {
	it("環境変数あり → configured: true", () => {
		const result = handleAuthStatus();
		const text = result.content[0].text as string;
		expect(text).toContain("true");
		expect(text).not.toContain("test-key");
		expect(text).not.toContain("test-token");
	});

	it("環境変数なし → configured: false", () => {
		vi.unstubAllEnvs();
		const result = handleAuthStatus();
		const text = result.content[0].text as string;
		expect(text).toContain("false");
	});

	it("readOnly モードでも呼び出せる", () => {
		const result = handleAuthStatus();
		expect(result.isError).toBeUndefined();
	});

	it("rate limit の残量を含む (STEP 2-7)", () => {
		const result = handleAuthStatus();
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed).toHaveProperty("dailyRequestsRemaining");
		expect(typeof parsed.dailyRequestsRemaining).toBe("number");
		expect(parsed).toHaveProperty("dailyRequestLimit");
		expect(parsed.dailyRequestLimit).toBe(3000);
	});
});
