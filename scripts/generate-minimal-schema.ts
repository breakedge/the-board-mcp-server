#!/usr/bin/env tsx
/**
 * Board OpenAPI spec から minimal schema を生成する。
 *
 * Usage:
 *   npx tsx scripts/generate-minimal-schema.ts [input-path]
 *
 * input-path を省略した場合、公式 URL からダウンロードする。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "../openapi/the-board.minimal.json");
const SPEC_URL = "https://developers.the-board.jp/doc/board_openapi.json";

interface OpenApiSpec {
	info?: { version?: string };
	paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
	summary?: string;
	parameters?: Array<{
		name: string;
		in: string;
		required?: boolean;
		schema?: { type?: string };
	}>;
}

interface MinimalOperation {
	summary: string;
	parameters?: Array<{ name: string; required: boolean; type: string }>;
}

interface MinimalSchema {
	version: string;
	paths: Record<string, Record<string, MinimalOperation>>;
}

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);

async function loadSpec(inputPath?: string): Promise<OpenApiSpec> {
	if (inputPath) {
		return JSON.parse(readFileSync(inputPath, "utf-8")) as OpenApiSpec;
	}
	const res = await fetch(SPEC_URL);
	if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
	return (await res.json()) as OpenApiSpec;
}

async function main() {
	const inputPath = process.argv[2];
	const spec = await loadSpec(inputPath);
	const paths = spec.paths ?? {};

	const minimal: MinimalSchema = {
		version: spec.info?.version ?? "unknown",
		paths: {},
	};

	for (const [path, methods] of Object.entries(paths)) {
		const normalizedPath = `/v1${path.startsWith("/") ? path : `/${path}`}`;
		minimal.paths[normalizedPath] = {};

		for (const [method, op] of Object.entries(methods)) {
			if (!METHODS.has(method)) continue;
			const entry: MinimalOperation = { summary: op.summary ?? "" };
			const queryParams = (op.parameters ?? []).filter((p) => p.in === "query");
			if (queryParams.length > 0) {
				entry.parameters = queryParams.map((p) => ({
					name: p.name,
					required: !!p.required,
					type: p.schema?.type ?? "string",
				}));
			}
			minimal.paths[normalizedPath][method.toUpperCase()] = entry;
		}
	}

	const json = JSON.stringify(minimal, null, "\t");
	writeFileSync(OUTPUT_PATH, `${json}\n`);

	const pathCount = Object.keys(minimal.paths).length;
	let opCount = 0;
	for (const methods of Object.values(minimal.paths)) {
		opCount += Object.keys(methods).length;
	}
	console.log(`Generated: ${pathCount} paths, ${opCount} operations`);
	console.log(`Output: ${OUTPUT_PATH} (${Buffer.byteLength(json)} bytes)`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
