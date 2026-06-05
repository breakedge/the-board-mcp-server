import { beforeAll, describe, expect, it } from "vitest";
import {
	loadSchema,
	matchPathPattern,
	sanitizePath,
	validatePath,
} from "../../src/openapi/schema-loader.js";

// ---------------------------------------------------------------------------
// sanitizePath
// ---------------------------------------------------------------------------
describe("sanitizePath", () => {
	it("/v1/clients はそのまま返す", () => {
		expect(sanitizePath("/v1/clients")).toBe("/v1/clients");
	});

	it("/v1/clients/123 はそのまま返す", () => {
		expect(sanitizePath("/v1/clients/123")).toBe("/v1/clients/123");
	});

	it("多重スラッシュを正規化する", () => {
		expect(sanitizePath("//v1//clients")).toBe("/v1/clients");
	});

	it(".. を含むパスは Error", () => {
		expect(() => sanitizePath("/v1/../etc/passwd")).toThrow();
	});

	it("CRLF を含むパスは Error", () => {
		expect(() => sanitizePath("/v1/clients\r\n")).toThrow();
	});

	it("\\n を含むパスは Error", () => {
		expect(() => sanitizePath("/v1/clients\n")).toThrow();
	});

	it("/v1/ 以外のプレフィックスは Error", () => {
		expect(() => sanitizePath("/v2/clients")).toThrow();
	});

	it("空文字は Error", () => {
		expect(() => sanitizePath("")).toThrow();
	});

	it("パーセントエンコーディングを含むパスは Error (エンコード済みトラバーサル対策)", () => {
		expect(() => sanitizePath("/v1/clients/%2e%2e")).toThrow();
	});

	it("エンコードされたスラッシュを含むパスは Error", () => {
		expect(() => sanitizePath("/v1/clients/%2e%2e%2fadmin")).toThrow();
	});
});

// ---------------------------------------------------------------------------
// matchPathPattern / validatePath  (schema が必要)
// ---------------------------------------------------------------------------
type LoadedSchema = Awaited<ReturnType<typeof loadSchema>>;
let schema: LoadedSchema;

beforeAll(async () => {
	schema = await loadSchema();
});

describe("matchPathPattern", () => {
	it("/v1/clients/123 → /v1/clients/{id} にマッチ", () => {
		expect(matchPathPattern("/v1/clients/123", schema)).toBe("/v1/clients/{id}");
	});

	it("/v1/clients → /v1/clients にマッチ (パラメータなし)", () => {
		expect(matchPathPattern("/v1/clients", schema)).toBe("/v1/clients");
	});

	it("/v1/projects/order_status/456 → /v1/projects/order_status/{id} にマッチ", () => {
		expect(matchPathPattern("/v1/projects/order_status/456", schema)).toBe(
			"/v1/projects/order_status/{id}",
		);
	});

	it("存在しないパスは null を返す", () => {
		expect(matchPathPattern("/v1/nonexistent", schema)).toBeNull();
	});

	it("存在しないパスパターンは null", () => {
		expect(matchPathPattern("/v1/nonexistent/123", schema)).toBeNull();
	});

	it("英数字・ハイフンのパスパラメータはマッチする", () => {
		expect(matchPathPattern("/v1/clients/abc-123", schema)).toBe("/v1/clients/{id}");
	});

	it("英数字・ハイフン以外を含むパスパラメータは null (param 値バリデーション)", () => {
		expect(matchPathPattern("/v1/clients/a;b", schema)).toBeNull();
	});

	it("スペースを含むパスパラメータは null", () => {
		expect(matchPathPattern("/v1/clients/1 2", schema)).toBeNull();
	});
});

describe("validatePath", () => {
	it("GET /v1/clients → true", () => {
		expect(validatePath("GET", "/v1/clients", schema)).toBe(true);
	});

	it("POST /v1/clients → true", () => {
		expect(validatePath("POST", "/v1/clients", schema)).toBe(true);
	});

	it("GET /v1/clients/123 → true (パスパラメータ)", () => {
		expect(validatePath("GET", "/v1/clients/123", schema)).toBe(true);
	});

	it("DELETE /v1/clients/123 → true", () => {
		expect(validatePath("DELETE", "/v1/clients/123", schema)).toBe(true);
	});

	it("GET /v1/nonexistent → false", () => {
		expect(validatePath("GET", "/v1/nonexistent", schema)).toBe(false);
	});

	it("POST /v1/clients/123 → false (POST はリスト系のみ)", () => {
		// /v1/clients/{id} には POST がない
		expect(validatePath("POST", "/v1/clients/123", schema)).toBe(false);
	});

	it("PUT /v1/clients → false (PUT メソッドなし)", () => {
		expect(validatePath("PUT", "/v1/clients", schema)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// loadSchema
// ---------------------------------------------------------------------------
describe("loadSchema", () => {
	it("schema オブジェクトを返しpathsキーが存在する", async () => {
		const s = await loadSchema();
		expect(s).toBeDefined();
		expect(s.paths).toBeDefined();
		expect(Object.keys(s.paths).length).toBeGreaterThan(0);
	});

	it("version が含まれる", async () => {
		const s = await loadSchema();
		expect(s.version).toBe("1.6.0");
	});
});
