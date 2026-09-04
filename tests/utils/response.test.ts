import { afterEach, describe, expect, it, vi } from "vitest";
import { TheBoardApiError, TheBoardTimeoutError } from "../../src/api/types.js";
import {
	createErrorResponse,
	createTextResponse,
	formatApiError,
} from "../../src/utils/response.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("createTextResponse", () => {
	it('"ok" を渡すと { content: [{ type: "text", text: "ok" }] } を返す', () => {
		const result = createTextResponse("ok");
		expect(result).toEqual({
			content: [{ type: "text", text: "ok" }],
		});
	});

	it("MCP 出力の最終境界で資格情報を伏字化する (A1)", () => {
		vi.stubEnv("THE_BOARD_API_TOKEN", "tok-secret-123");
		const text = createTextResponse('{"query":{"name_cont":"tok-secret-123"}}').content[0]
			.text as string;
		expect(text).not.toContain("tok-secret-123");
		expect(text).toContain("[REDACTED_TOKEN]");
	});
});

describe("createErrorResponse", () => {
	it('"err" を渡すと isError: true のレスポンスを返す', () => {
		const result = createErrorResponse("err");
		expect(result).toEqual({
			content: [{ type: "text", text: "err" }],
			isError: true,
		});
	});

	it("MCP 出力の最終境界で資格情報を伏字化する (A1)", () => {
		vi.stubEnv("THE_BOARD_API_TOKEN", "tok-secret-123");
		const result = createErrorResponse("値: tok-secret-123");
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe("値: [REDACTED_TOKEN]");
	});
});

describe("formatApiError", () => {
	it("400 → 日本語メッセージ", () => {
		const err = new TheBoardApiError("Bad Request", 400, {});
		expect(formatApiError(err)).toContain("リクエストが不正です");
	});

	it("401 → 認証失敗メッセージ", () => {
		const err = new TheBoardApiError("Unauthorized", 401, {});
		expect(formatApiError(err)).toContain("認証に失敗しました");
	});

	it("403 → アクセス権限メッセージ", () => {
		const err = new TheBoardApiError("Forbidden", 403, {});
		expect(formatApiError(err)).toContain("アクセス権限がありません");
	});

	it("404 → リソース未検出メッセージ", () => {
		const err = new TheBoardApiError("Not Found", 404, {});
		expect(formatApiError(err)).toContain("見つかりませんでした");
	});

	it("422 → 入力値メッセージ", () => {
		const err = new TheBoardApiError("Unprocessable", 422, {
			message: "Validation failed",
			errors: { name: ["can't be blank"] },
		});
		const msg = formatApiError(err);
		expect(msg).toContain("入力値が正しくありません");
	});

	it("422 で errors の値が文字列(非配列)でも例外を投げず field/内容を含む", () => {
		// board 本番 API は errors の値を配列でない形で返すことがある
		const err = new TheBoardApiError("Unprocessable", 422, {
			errors: { name: "を入力してください" },
		});
		expect(() => formatApiError(err)).not.toThrow();
		const msg = formatApiError(err);
		expect(msg).toContain("入力値が正しくありません");
		expect(msg).toContain("name");
		expect(msg).toContain("を入力してください");
	});

	it("422 で errors の値がネストオブジェクトでも例外を投げない", () => {
		const err = new TheBoardApiError("Unprocessable", 422, {
			errors: { client: { name: "invalid" } },
		});
		expect(() => formatApiError(err)).not.toThrow();
		expect(formatApiError(err)).toContain("入力値が正しくありません");
	});

	it("422 の errors が配列なら field: description (code) で整形する", () => {
		const err = new TheBoardApiError(
			"パラメータが正しくありません。",
			422,
			{
				errors: [
					{
						field: "per_page",
						code: "less_than_or_equal_to",
						description: "per_pageは100以下の値にしてください。",
					},
				],
			},
			"GET",
			"/v1/projects",
		);
		const msg = formatApiError(err);
		expect(msg).toContain(
			"per_page: per_pageは100以下の値にしてください。 (less_than_or_equal_to)",
		);
		expect(msg).not.toContain("0:");
	});

	it("429 → レート制限メッセージ", () => {
		const err = new TheBoardApiError("Too Many Requests", 429, {});
		expect(formatApiError(err)).toContain("レート制限");
	});

	it("500 → サーバーエラーメッセージ", () => {
		const err = new TheBoardApiError("Internal Server Error", 500, {});
		expect(formatApiError(err)).toContain("エラーが発生しました");
	});

	it("503 → サーバーエラーメッセージ", () => {
		const err = new TheBoardApiError("Service Unavailable", 503, {});
		expect(formatApiError(err)).toContain("エラーが発生しました");
	});

	it("404 → board の実メッセージを併記する (B2-1)", () => {
		const err = new TheBoardApiError("Project 123 not found", 404, {});
		const msg = formatApiError(err);
		expect(msg).toContain("見つかりませんでした");
		expect(msg).toContain("Project 123 not found");
	});

	it("400 → board の実メッセージを併記する (B2-1)", () => {
		const err = new TheBoardApiError("invoice_date is required", 400, {});
		const msg = formatApiError(err);
		expect(msg).toContain("リクエストが不正です");
		expect(msg).toContain("invoice_date is required");
	});

	it("不明な Error → 予期しないエラーメッセージ", () => {
		const err = new Error("something went wrong");
		expect(formatApiError(err)).toContain("予期しないエラー");
	});

	it("不明な Error → err.message を併記して原因を示す (B2-3)", () => {
		const err = new Error("fetch failed: ECONNREFUSED");
		expect(formatApiError(err)).toContain("fetch failed: ECONNREFUSED");
	});

	it("不明な Error の message に含まれる資格情報を伏字化する (defense-in-depth)", () => {
		vi.stubEnv("THE_BOARD_API_TOKEN", "secret-token-xyz");
		const err = new Error("connection failed using Bearer secret-token-xyz");
		const msg = formatApiError(err);
		expect(msg).toContain("予期しないエラー");
		expect(msg).not.toContain("secret-token-xyz");
	});

	it("method/path を持つ 404 はリクエスト文脈を含む (B2-2)", () => {
		const err = new TheBoardApiError("Not Found", 404, {}, "GET", "/v1/documents/invoices/123");
		const msg = formatApiError(err);
		expect(msg).toContain("見つかりませんでした");
		expect(msg).toContain("GET /v1/documents/invoices/123");
	});

	it("timeout は「予期しないエラー」にせずそのまま伝える (D1)", () => {
		const msg = formatApiError(
			new TheBoardTimeoutError(
				"board API が 30 秒以内に応答しませんでした [GET /v1/users]",
				"GET",
				"/v1/users",
			),
		);
		expect(msg).not.toContain("予期しない");
		expect(msg).toBe("board API が 30 秒以内に応答しませんでした [GET /v1/users]");
	});

	it("Error以外 (string) → 予期しないエラーメッセージ", () => {
		expect(formatApiError("unknown")).toContain("予期しないエラー");
	});
});
