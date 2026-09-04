import { describe, expect, it } from "vitest";
import { aliasesForPath } from "../../src/openapi/aliases.js";

describe("aliasesForPath", () => {
	it("prefix で別名を引く", () => {
		expect(aliasesForPath("/v1/analyses")).toContain("sales");
		expect(aliasesForPath("/v1/analyses")).toContain("売上");
		expect(aliasesForPath("/v1/clients/{id}")).toContain("customer");
	});
	it("documents 系は 2 段目まで見る", () => {
		expect(aliasesForPath("/v1/documents/estimates/{id}")).toContain("quote");
		expect(aliasesForPath("/v1/documents/receipts/lock_flg/{id}")).toContain("領収");
	});
	it("ステータス変更パスは親 prefix の別名", () => {
		expect(aliasesForPath("/v1/projects/order_status/{id}")).toContain("案件");
	});
	it("未知の prefix は空配列", () => {
		expect(aliasesForPath("/v1/unknown")).toEqual([]);
	});
});
