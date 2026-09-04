import { beforeAll, describe, expect, it } from "vitest";
import { formatPathNotFound } from "../../src/openapi/path-hints.js";
import { loadSchema } from "../../src/openapi/schema-loader.js";
import type { MinimalSchema } from "../../src/openapi/types.js";

let schema: MinimalSchema;
beforeAll(async () => {
	schema = await loadSchema();
});

describe("formatPathNotFound", () => {
	it("パスはあるが method 非対応なら対応 method と業務上の案内を返す", () => {
		const msg = formatPathNotFound("POST", "/v1/invoices", schema);
		expect(msg).toContain("POST に対応していません");
		expect(msg).toContain("GET");
		expect(msg).toContain("POST /v1/projects");
		expect(msg).not.toContain("。 ");
	});
	it("未知パスは同じ prefix の候補を最大 5 件返す", () => {
		const msg = formatPathNotFound("GET", "/v1/documents/invoices", schema);
		expect(msg).toContain("パスが見つかりません");
		expect(msg).toContain("/v1/documents/invoices/{id}");
		expect((msg.match(/\/v1\//g) ?? []).length).toBeLessThanOrEqual(6);
	});
	it("候補が無ければ list_paths を案内する", () => {
		expect(formatPathNotFound("GET", "/v1/zzz", schema)).toContain("the_board_api_list_paths");
	});
});
