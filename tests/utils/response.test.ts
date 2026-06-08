import { describe, expect, it } from "vitest";
import { TheBoardApiError } from "../../src/api/types.js";
import {
	createErrorResponse,
	createTextResponse,
	formatApiError,
} from "../../src/utils/response.js";

describe("createTextResponse", () => {
	it('"ok" を渡すと { content: [{ type: "text", text: "ok" }] } を返す', () => {
		const result = createTextResponse("ok");
		expect(result).toEqual({
			content: [{ type: "text", text: "ok" }],
		});
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

	it("不明な Error → 予期しないエラーメッセージ", () => {
		const err = new Error("something went wrong");
		expect(formatApiError(err)).toContain("予期しないエラー");
	});

	it("Error以外 (string) → 予期しないエラーメッセージ", () => {
		expect(formatApiError("unknown")).toContain("予期しないエラー");
	});
});
