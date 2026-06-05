import { beforeAll, describe, expect, it } from "vitest";
import { loadSchema } from "../../src/openapi/schema-loader.js";
import { isPathEnabled, pathToToolset } from "../../src/openapi/toolsets.js";
import type { MinimalSchema } from "../../src/openapi/types.js";

describe("pathToToolset", () => {
	it("/v1/projects → projects", () => {
		expect(pathToToolset("/v1/projects")).toBe("projects");
	});

	it("/v1/projects/123 → projects (パスパラメータ付き)", () => {
		expect(pathToToolset("/v1/projects/123")).toBe("projects");
	});

	it("/v1/analyses → analytics", () => {
		expect(pathToToolset("/v1/analyses")).toBe("analytics");
	});

	it("/v1/payees → payees", () => {
		expect(pathToToolset("/v1/payees")).toBe("payees");
	});

	it("マップ外の prefix は null", () => {
		expect(pathToToolset("/v1/unknown_resource")).toBeNull();
	});
});

describe("isPathEnabled", () => {
	it("有効な toolset に属するパスは true", () => {
		expect(isPathEnabled("/v1/projects", ["projects", "documents"])).toBe(true);
	});

	it("無効な toolset に属するパスは false", () => {
		expect(isPathEnabled("/v1/projects", ["documents"])).toBe(false);
	});

	it("マップ外パスは fail-open で true (toolset 制御対象外)", () => {
		expect(isPathEnabled("/v1/unknown_resource", ["documents"])).toBe(true);
	});
});

// マッピング網羅性ガード: schema の全パスが必ず toolset に割り当てられていること。
// マップ漏れがあると当該パスが toolset フィルタを素通りするため、テストで検出する。
describe("toolset マッピングの網羅性", () => {
	let schema: MinimalSchema;
	beforeAll(async () => {
		schema = await loadSchema();
	});

	it("全 schema パスが toolset にマップされている", () => {
		const unmapped = Object.keys(schema.paths).filter((p) => pathToToolset(p) === null);
		expect(unmapped).toEqual([]);
	});
});
