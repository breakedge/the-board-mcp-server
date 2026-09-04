import { describe, expect, it } from "vitest";
import { validateQueryValues } from "../../src/openapi/query-validate.js";
import type { MinimalParameter } from "../../src/openapi/types.js";

const params: MinimalParameter[] = [
	{ name: "client_id_eq", required: false, type: "integer" },
	{
		name: "invoice_status_in[]",
		required: false,
		type: "string",
		enum: [1, 2, 3],
		enumLabels: { "1": "未請求", "2": "請求済", "3": "入金済" },
	},
	{ name: "invoice_date_gteq", required: false, type: "string" },
	{ name: "report_ym_gteq", required: false, type: "string" },
	{
		name: "response_group",
		required: false,
		type: "string",
		enum: ["small", "medium", "large", "all"],
	},
	{
		name: "document_send_type_eq",
		required: false,
		type: "integer",
		enum: [1, 2],
		enumLabels: { "1": "メール", "2": "郵送" },
		enumOpen: true,
	},
	{ name: "per_page", required: false, type: "integer" },
	{ name: "page", required: false, type: "integer" },
];

describe("validateQueryValues", () => {
	it("整数型に非整数を渡すと拒否", () => {
		expect(validateQueryValues({ client_id_eq: "abc" }, params)).toContain("client_id_eq");
		expect(validateQueryValues({ client_id_eq: 12 }, params)).toBeNull();
		expect(validateQueryValues({ client_id_eq: "12" }, params)).toBeNull();
	});
	it("enum 外の値は有効値 (ラベル付き) を添えて拒否、配列は各要素を検査", () => {
		const msg = validateQueryValues({ "invoice_status_in[]": ["1", "9"] }, params);
		expect(msg).toContain("9");
		expect(msg).toContain("1:未請求");
		expect(validateQueryValues({ "invoice_status_in[]": [1, "2"] }, params)).toBeNull();
		expect(validateQueryValues({ response_group: "huge" }, params)).toContain("small");
	});

	it("enum は decimal 文字列も数値同値で比較する ('2.0' は 2 と一致) (0.3.1)", () => {
		expect(validateQueryValues({ "invoice_status_in[]": ["2.0"] }, params)).toBeNull();
	});
	it("日付は YYYY-MM-DD、計上年月は YYYY-MM", () => {
		expect(validateQueryValues({ invoice_date_gteq: "2026/08/01" }, params)).toContain(
			"YYYY-MM-DD",
		);
		expect(validateQueryValues({ invoice_date_gteq: "2026-08-01" }, params)).toBeNull();
		expect(validateQueryValues({ report_ym_gteq: "2026-08-01" }, params)).toContain("YYYY-MM");
		expect(validateQueryValues({ report_ym_gteq: "2026-08" }, params)).toBeNull();
	});
	it("per_page は 1〜100、page は 1 以上", () => {
		expect(validateQueryValues({ per_page: 1000 }, params)).toContain("100");
		expect(validateQueryValues({ per_page: 0 }, params)).not.toBeNull();
		expect(validateQueryValues({ per_page: 100, page: 1 }, params)).toBeNull();
		expect(validateQueryValues({ page: 0 }, params)).not.toBeNull();
	});
	it("enumOpen のパラメータは enum 外の値 (カスタム ID) を通す (B3)", () => {
		expect(validateQueryValues({ document_send_type_eq: 99 }, params)).toBeNull();
		expect(validateQueryValues({ document_send_type_eq: 1 }, params)).toBeNull();
	});
	it("スキーマに無いキーと null は検査しない", () => {
		expect(validateQueryValues({ unknown_key: "x", client_id_eq: null }, params)).toBeNull();
	});
});
