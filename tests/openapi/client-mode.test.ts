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
		const result = handleListPaths({ detail: true }, makeConfig(), schema);
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
		const result = handleListPaths({ method: "GET", detail: true }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.every((e: { method: string }) => e.method === "GET")).toBe(true);
	});

	it("keyword='client' でパス/summary/別名/パラメータ名に 'client' を含むもの", () => {
		// keyword は path/summary/aliases/parameter 名を横断して検索するため (Task 8 の仕様)、
		// client_id_eq 等のパラメータ名一致もヒットしうる。
		const result = handleListPaths({ keyword: "client", detail: true }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.length).toBeGreaterThan(0);
		expect(
			parsed.every(
				(e: {
					path: string;
					summary: string;
					aliases: string[];
					parameters?: { name: string }[];
				}) =>
					e.path.toLowerCase().includes("client") ||
					e.summary.toLowerCase().includes("client") ||
					e.summary.includes("顧客") ||
					e.aliases.some((a) => a.toLowerCase().includes("client")) ||
					(e.parameters ?? []).some((p) => p.name.toLowerCase().includes("client")),
			),
		).toBe(true);
	});

	it("method + keyword の組み合わせ", () => {
		const result = handleListPaths(
			{ method: "POST", keyword: "client", detail: true },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.every((e: { method: string }) => e.method === "POST")).toBe(true);
	});

	it("toolsets で有効ドメインのみに絞る (--toolsets projects)", () => {
		const result = handleListPaths(
			{ detail: true },
			makeConfig({ toolsets: ["projects"] }),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.length).toBeGreaterThan(0);
		// projects ドメイン (/v1/projects*, /v1/project_costs*) のパスのみ
		expect(parsed.every((e: { path: string }) => e.path.startsWith("/v1/project"))).toBe(true);
		// documents ドメインのパスは含まれない
		expect(parsed.some((e: { path: string }) => e.path.startsWith("/v1/documents"))).toBe(false);
	});

	it("toolsets で絞り込み中は別 content で注記する (B3-6)", () => {
		const result = handleListPaths({}, makeConfig({ toolsets: ["projects"] }), schema);
		expect(result.content.length).toBeGreaterThan(1);
		const text = result.content.map((c) => c.text).join("\n");
		expect(text).toContain("toolset");
	});

	it("全 toolsets 有効なら注記を付けない (B3-6)", () => {
		const result = handleListPaths({}, makeConfig(), schema);
		expect(result.content.length).toBe(1);
	});

	it("parameters を持つエンドポイントは出力に parameters を含む (B1-3)", () => {
		const result = handleListPaths(
			{ method: "GET", keyword: "projects", detail: true },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		const projects = parsed.find(
			(e: { path: string; method: string }) => e.path === "/v1/projects" && e.method === "GET",
		);
		expect(projects).toBeDefined();
		expect(Array.isArray(projects.parameters)).toBe(true);
		expect(projects.parameters.map((p: { name: string }) => p.name)).toContain("project_no_eq");
	});

	it("parameters を持たないエンドポイントには parameters を付けない (B1-3)", () => {
		const result = handleListPaths(
			{ method: "POST", keyword: "client", detail: true },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		const post = parsed.find((e: { path: string }) => e.path === "/v1/clients");
		expect(post).toBeDefined();
		expect(post.parameters).toBeUndefined();
	});

	it("list_paths のパラメータは軽量で enum/description を含めない (B1-3 lean)", () => {
		// 詳細(enum/説明)は describe で取得する。discovery 出力は軽量に保つ。
		const result = handleListPaths(
			{ method: "GET", keyword: "projects", detail: true },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		const projects = parsed.find(
			(e: { path: string; method: string }) => e.path === "/v1/projects" && e.method === "GET",
		);
		const rg = projects.parameters.find((p: { name: string }) => p.name === "response_group");
		expect(rg.type).toBe("string");
		expect(rg.enum).toBeUndefined();
		expect(rg.description).toBeUndefined();
	});

	it("既定は 1 行 1 endpoint のテキストで、別名を角括弧で付ける", () => {
		const result = handleListPaths({}, makeConfig(), schema);
		const text = result.content[0].text as string;
		expect(text.startsWith("{") || text.startsWith("[")).toBe(false);
		const lines = text.split("\n");
		expect(lines.length).toBeGreaterThan(80);
		expect(lines.find((l) => l.startsWith("GET /v1/analyses "))).toMatch(/\[.*sales.*\]/);
	});

	it("英語の別名で検索できる", () => {
		const text = handleListPaths({ keyword: "sales" }, makeConfig(), schema).content[0]
			.text as string;
		expect(text).toContain("/v1/analyses");
		expect(text).not.toContain("/v1/clients");
	});

	it("パラメータ名でも検索できる", () => {
		const text = handleListPaths({ keyword: "project_no_eq" }, makeConfig(), schema).content[0]
			.text as string;
		expect(text).toContain("GET /v1/projects ");
	});

	it("空白区切りの複数語は OR", () => {
		const text = handleListPaths({ keyword: "sales contact" }, makeConfig(), schema).content[0]
			.text as string;
		expect(text).toContain("/v1/analyses");
		expect(text).toContain("/v1/contacts");
	});

	it("該当なしのときは案内文", () => {
		const text = handleListPaths({ keyword: "zzzz" }, makeConfig(), schema).content[0]
			.text as string;
		expect(text).toContain("該当する endpoint はありません");
	});

	it("detail=true は enum を短縮表記で含む JSON", () => {
		const parsed = JSON.parse(
			handleListPaths({ keyword: "invoices", method: "GET", detail: true }, makeConfig(), schema)
				.content[0].text as string,
		);
		const inv = parsed.find((e: { path: string }) => e.path === "/v1/invoices");
		const status = inv.parameters.find((p: { name: string }) => p.name === "invoice_status_in[]");
		expect(status.values).toContain("1:未請求");
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

	it("存在する path でも未対応 method は isError", () => {
		// /v1/clients は GET/POST のみ。DELETE は未定義。
		const result = handleDescribe({ path: "/v1/clients", method: "DELETE" }, makeConfig(), schema);
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

	it("variant 未指定なら共通フィールドと variant の一覧 (title / required / fields) を返す", () => {
		const parsed = JSON.parse(
			handleDescribe({ path: "/v1/projects", method: "POST" }, makeConfig(), schema).content[0]
				.text as string,
		);
		expect(parsed.requestBody.properties.map((p: { name: string }) => p.name)).toContain("name");
		expect(parsed.variants.map((v: { title: string }) => v.title)).toEqual([
			"一括請求",
			"定期請求",
			"分割請求",
		]);
		expect(parsed.variants[0].fields).toContain("invoice_date");
		expect(parsed.variants[0]).not.toHaveProperty("properties");
		expect(parsed.notice).toContain("variant");
		expect(parsed).not.toHaveProperty("responseFields");
	});

	it("variant 指定なら当該分岐のフィールド定義を返し variants 一覧は出さない", () => {
		const parsed = JSON.parse(
			handleDescribe(
				{ path: "/v1/projects", method: "POST", variant: "一括請求" },
				makeConfig(),
				schema,
			).content[0].text as string,
		);
		expect(parsed.variant.title).toBe("一括請求");
		expect(parsed.variant.properties.map((p: { name: string }) => p.name)).toContain(
			"invoice_date",
		);
		expect(parsed).not.toHaveProperty("variants");
	});

	it("存在しない variant は候補付きでエラー", () => {
		const result = handleDescribe(
			{ path: "/v1/projects", method: "POST", variant: "月次" },
			makeConfig(),
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("一括請求");
	});

	it("variant を持たない endpoint に variant を渡すとエラー", () => {
		const result = handleDescribe(
			{ path: "/v1/clients", method: "POST", variant: "存在しない" },
			makeConfig(),
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("variant はありません");
	});

	it("part=response と存在しない variant の組み合わせもエラーになる (variant は無視されない)", () => {
		const result = handleDescribe(
			{ path: "/v1/projects", method: "POST", variant: "月次", part: "response" },
			makeConfig(),
			schema,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("一括請求");
	});

	it("part=response は responseFields だけを返す", () => {
		const parsed = JSON.parse(
			handleDescribe(
				{ path: "/v1/projects", method: "GET", part: "response" },
				makeConfig(),
				schema,
			).content[0].text as string,
		);
		expect(parsed).not.toHaveProperty("parameters");
		const total = parsed.responseFields.find((f: { name: string }) => f.name === "total");
		expect(total.description).toContain("税抜");
	});

	it("part=all は両方を返す", () => {
		const parsed = JSON.parse(
			handleDescribe({ path: "/v1/invoices", method: "GET", part: "all" }, makeConfig(), schema)
				.content[0].text as string,
		);
		expect(parsed.parameters).toBeDefined();
		expect(parsed.responseFields).toBeDefined();
	});

	it("enum を持つパラメータは enumLabels 付きで返す", () => {
		const parsed = JSON.parse(
			handleDescribe({ path: "/v1/invoices", method: "GET" }, makeConfig(), schema).content[0]
				.text as string,
		);
		const status = parsed.parameters.find(
			(p: { name: string }) => p.name === "invoice_status_in[]",
		);
		expect(status.enumLabels["1"]).toBe("未請求");
		expect(status.description).not.toContain("URLエンコード");
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

	it("リスト GET は envelope の pagination にページネーション情報を含む (B2-5)", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json([{ id: 1 }], {
					headers: { "X-Total-Count": "57", "X-Page": "1", "X-Per-Page": "20" },
				}),
			),
		);
		const result = await handleGet({ path: "/v1/clients" }, makeConfig(), schema);
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.data).toEqual([{ id: 1 }]); // 本体は維持
		expect(parsed.pagination.total_count).toBe(57);
		expect(parsed.pagination.page).toBe(1);
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

	it("配列内にオブジェクトを含むクエリは API に送らず isError (B0-4拡張)", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/projects`, () => HttpResponse.json([])));
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/projects", query: { "tags[]": [{ id: 1 }] } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
	});

	it("配列内に配列を含むクエリは API に送らず isError (B0-4拡張)", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/projects`, () => HttpResponse.json([])));
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/projects", query: { "tags[]": [[1, 2]] } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
	});

	it("配列内に undefined を含むクエリは API に送らず isError (B0-4 allowlist)", async () => {
		// allowlist 化前は typeof undefined !== "object" ですり抜け、String(undefined)="undefined" が送られていた。
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/projects`, () => HttpResponse.json([])));
		const config = makeConfig();
		const result = await handleGet(
			{ path: "/v1/projects", query: { "tags[]": ["ok", undefined] } },
			config,
			schema,
		);
		expect(result.isError).toBe(true);
	});

	it("既定 (concise) は compact JSON で null キーを省き、0 / false / 空配列は残す", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json([{ id: 1, fax: null, count: 0, flag: false, tags: [] }], {
					headers: { "X-Total-Count": "1", "X-Page": "1", "X-Per-Page": "10" },
				}),
			),
		);
		const result = await handleGet({ path: "/v1/clients" }, makeConfig(), schema);
		const text = result.content[0].text as string;
		expect(text).not.toContain("\n");
		expect(JSON.parse(text)).toEqual({
			data: [{ id: 1, count: 0, flag: false, tags: [] }],
			pagination: { total_count: 1, page: 1, per_page: 10, returned_count: 1, has_more: false },
			truncated: false,
		});
	});

	it("format=detailed は pretty JSON で null を残す", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients/1`, () => HttpResponse.json({ id: 1, fax: null })),
		);
		const result = await handleGet(
			{ path: "/v1/clients/1", format: "detailed" },
			makeConfig(),
			schema,
		);
		const text = result.content[0].text as string;
		expect(text).toContain("\n");
		expect(JSON.parse(text)).toEqual({ data: { id: 1, fax: null } });
	});

	it("fields で絞り込み、未知のキーは unknown_fields に載せる", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, () =>
				HttpResponse.json([{ id: 1, name: "a", client: { id: 2, name: "c" }, total: "1.0" }], {
					headers: { "X-Total-Count": "1" },
				}),
			),
		);
		const result = await handleGet(
			{ path: "/v1/projects", fields: "id,client.name,nope" },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.data).toEqual([{ id: 1, client: { name: "c" } }]);
		expect(parsed.unknown_fields).toEqual(["nope"]);
	});

	it("上限超過時はレコード単位で切り詰め truncated=true", async () => {
		vi.stubEnv("THE_BOARD_MAX_RESPONSE_CHARS", "400");
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, () =>
				HttpResponse.json(
					Array.from({ length: 10 }, (_, i) => ({ id: i, name: "x".repeat(60) })),
					{ headers: { "X-Total-Count": "10", "X-Page": "1", "X-Per-Page": "10" } },
				),
			),
		);
		const result = await handleGet({ path: "/v1/projects" }, makeConfig(), schema);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.truncated).toBe(true);
		expect(parsed.data.length).toBeLessThan(10);
		expect(parsed.data.length + parsed.dropped_in_page).toBe(10);
	});

	it("0 件のとき request を echo する", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, () =>
				HttpResponse.json([], {
					headers: { "X-Total-Count": "0", "X-Page": "1", "X-Per-Page": "10" },
				}),
			),
		);
		const result = await handleGet(
			{ path: "/v1/projects", query: { name_cont: "zzz" } },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.data).toEqual([]);
		expect(parsed.request).toEqual({ path: "/v1/projects", query: { name_cont: "zzz" } });
		expect(parsed.validated).toBe(true);
	});

	it("0 件のとき fields を指定しても unknown_fields を載せない", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, () =>
				HttpResponse.json([], {
					headers: { "X-Total-Count": "0", "X-Page": "1", "X-Per-Page": "10" },
				}),
			),
		);
		const result = await handleGet(
			{ path: "/v1/projects", fields: "id,name" },
			makeConfig(),
			schema,
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.data).toEqual([]);
		expect(parsed.validated).toBe(true);
		expect(parsed).not.toHaveProperty("unknown_fields");
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

	it("明細あり・total 未指定の文書 PATCH は警告を返す (B0-3)", async () => {
		mswServer.use(
			http.patch(`${TEST_BASE_URL}/v1/documents/estimates/1`, () => HttpResponse.json({ id: 1 })),
		);
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePatch(
			{ path: "/v1/documents/estimates/1", body: { details: [{ price: 1000 }] } },
			config,
			schema,
		);
		expect(result.isError).toBeUndefined();
		const text = result.content.map((c) => c.text).join("\n");
		expect(text).toContain("total");
		expect(text).toContain("自動集計");
	});

	it("明細あり・total 指定済みの文書 PATCH は警告を出さない (B0-3)", async () => {
		mswServer.use(
			http.patch(`${TEST_BASE_URL}/v1/documents/estimates/1`, () => HttpResponse.json({ id: 1 })),
		);
		const config = makeConfig({ readOnly: false, enableWrites: true });
		const result = await handlePatch(
			{
				path: "/v1/documents/estimates/1",
				body: { details: [{ price: 1000 }], total: 1000, tax: 100 },
			},
			config,
			schema,
		);
		const text = result.content.map((c) => c.text).join("\n");
		expect(text).not.toContain("自動集計");
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
	it("環境変数あり → configured: true", async () => {
		const result = await handleAuthStatus();
		const text = result.content[0].text as string;
		expect(text).toContain("true");
		expect(text).not.toContain("test-key");
		expect(text).not.toContain("test-token");
	});

	it("環境変数なし → configured: false", async () => {
		vi.unstubAllEnvs();
		const result = await handleAuthStatus();
		const text = result.content[0].text as string;
		expect(text).toContain("false");
	});

	it("readOnly モードでも呼び出せる", async () => {
		const result = await handleAuthStatus();
		expect(result.isError).toBeUndefined();
	});

	it("rate limit の残量を含む (STEP 2-7)", async () => {
		const result = await handleAuthStatus();
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed).toHaveProperty("dailyRequestsRemaining");
		expect(typeof parsed.dailyRequestsRemaining).toBe("number");
		expect(parsed).toHaveProperty("dailyRequestLimit");
		expect(parsed.dailyRequestLimit).toBe(3000);
	});

	it("既定では資格情報の実検証を行わない (credentialsValid 無し)", async () => {
		const result = await handleAuthStatus();
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBeUndefined();
	});

	it("validate=true: API が成功すれば credentialsValid: true (B3-4)", async () => {
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/clients`, () => HttpResponse.json([])));
		const result = await handleAuthStatus({ validate: true });
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBe(true);
	});

	it("validate=true: 401 なら credentialsValid: false (B3-4)", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json({ message: "Unauthorized" }, { status: 401 }),
			),
		);
		const result = await handleAuthStatus({ validate: true });
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBe(false);
	});

	it("validate=true: 403 は credentialsValid: true (認証は通り権限不足のみ)", async () => {
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
			),
		);
		const result = await handleAuthStatus({ validate: true }, makeConfig());
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBe(true);
	});

	it("validate=true: 無効 toolset の /v1/clients を叩かず有効 toolset を probe する", async () => {
		let clientsCalled = false;
		let projectsCalled = false;
		mswServer.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				clientsCalled = true;
				return HttpResponse.json([]);
			}),
			http.get(`${TEST_BASE_URL}/v1/projects`, () => {
				projectsCalled = true;
				return HttpResponse.json([]);
			}),
		);
		const result = await handleAuthStatus(
			{ validate: true },
			makeConfig({ toolsets: ["projects"] }),
		);
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBe(true);
		expect(clientsCalled).toBe(false);
		expect(projectsCalled).toBe(true);
	});

	it("validate=true: ネットワーク障害は credentialsValid:null + validationError(伏字化済み)", async () => {
		// 401/403 以外・非 TheBoardApiError の分岐。誤って invalid 判定せず null とし、
		// validationError は redactSecrets を通す(防御的措置)。
		mswServer.use(http.get(`${TEST_BASE_URL}/v1/clients`, () => HttpResponse.error()));
		const result = await handleAuthStatus({ validate: true }, makeConfig());
		const parsed = JSON.parse(result.content[0].text as string);
		expect(parsed.credentialsValid).toBeNull();
		expect(typeof parsed.validationError).toBe("string");
		expect(parsed.validationError).not.toContain("test-token");
	});
});
