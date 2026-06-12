#!/usr/bin/env tsx
/**
 * board OpenAPI spec から minimal schema を生成する。
 *
 * minimal schema は AI エージェントが外部資料を見ずに API を呼べるよう、
 * クエリパラメータ (enum/説明込み) と requestBody のフィールド定義を含む。
 * describe ツールがこのスキーマを遅延参照して endpoint 詳細を返す前提のため、
 * サイズより「ボディ構造の網羅」を優先する (説明は切り詰めて肥大化を抑える)。
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

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);
const MAX_DEPTH = 4;
const DESC_MAX = 200;

// biome-ignore lint/suspicious/noExplicitAny: 外部 OpenAPI spec は任意構造のため any で扱う
type Json = any;

interface MinimalParameter {
	name: string;
	required: boolean;
	type: string;
	enum?: (string | number)[];
	description?: string;
}
interface MinimalField {
	name: string;
	type?: string;
	required?: boolean;
	enum?: (string | number)[];
	description?: string;
	properties?: MinimalField[];
	items?: { type?: string; properties?: MinimalField[] };
}
interface MinimalRequestBody {
	required?: string[];
	properties: MinimalField[];
}
interface MinimalOperation {
	summary: string;
	parameters?: MinimalParameter[];
	requestBody?: MinimalRequestBody;
}
interface MinimalSchema {
	version: string;
	paths: Record<string, Record<string, MinimalOperation>>;
}

let spec: Json;

/** $ref を解決する (循環は null を返す)。 */
function resolveRef(node: Json, seen: Set<string>): Json {
	let current = node;
	while (current && typeof current === "object" && typeof current.$ref === "string") {
		if (seen.has(current.$ref)) return null;
		seen.add(current.$ref);
		const path = current.$ref.replace(/^#\//, "").split("/");
		let target: Json = spec;
		for (const key of path) target = target?.[decodeURIComponent(key)];
		current = target;
	}
	return current;
}

function cleanDescription(desc: unknown): string | undefined {
	if (typeof desc !== "string") return undefined;
	const collapsed = desc.replace(/\s+/g, " ").trim();
	if (!collapsed) return undefined;
	return collapsed.length > DESC_MAX ? `${collapsed.slice(0, DESC_MAX)}…` : collapsed;
}

/** allOf を平坦化し、{type, properties, required, enum, items, description} を返す。 */
function flatten(schema: Json, seen: Set<string>): Json {
	const resolved = resolveRef(schema, new Set(seen));
	if (!resolved || typeof resolved !== "object") return {};
	if (Array.isArray(resolved.allOf)) {
		const merged: Json = { type: "object", properties: {}, required: [] as string[] };
		// allOf と同階層に置かれた required (例: POST /clients の name/name_disp) も取り込む
		if (Array.isArray(resolved.required)) merged.required.push(...resolved.required);
		if (resolved.properties) Object.assign(merged.properties, resolved.properties);
		for (const part of resolved.allOf) {
			const flat = flatten(part, new Set(seen));
			if (flat.type && flat.type !== "object") merged.type = flat.type;
			Object.assign(merged.properties, flat.properties ?? {});
			if (Array.isArray(flat.required)) merged.required.push(...flat.required);
			if (flat.items) merged.items = flat.items;
			if (flat.description && !merged.description) merged.description = flat.description;
		}
		return merged;
	}
	// oneOf/anyOf は先頭候補のみ採用 (構造の目安を示す)
	if (Array.isArray(resolved.oneOf)) return flatten(resolved.oneOf[0], new Set(seen));
	if (Array.isArray(resolved.anyOf)) return flatten(resolved.anyOf[0], new Set(seen));
	return resolved;
}

/** スキーマのプロパティ集合を MinimalField[] に変換 (depth 制限・readOnly 除外)。 */
function toFields(schema: Json, seen: Set<string>, depth: number): MinimalField[] {
	const flat = flatten(schema, seen);
	const props = flat.properties as Record<string, Json> | undefined;
	if (!props) return [];
	const requiredSet = new Set<string>(Array.isArray(flat.required) ? flat.required : []);
	const fields: MinimalField[] = [];
	for (const [name, rawProp] of Object.entries(props)) {
		const prop = flatten(rawProp, seen);
		if (prop.readOnly === true) continue; // 書き込みボディに設定不可
		const field: MinimalField = { name };
		if (prop.type) field.type = prop.type;
		if (requiredSet.has(name)) field.required = true;
		if (Array.isArray(prop.enum)) field.enum = prop.enum;
		const desc = cleanDescription(prop.description);
		if (desc) field.description = desc;
		if (depth < MAX_DEPTH) {
			if (prop.type === "array" && prop.items) {
				const itemFlat = flatten(prop.items, seen);
				const item: { type?: string; properties?: MinimalField[] } = {};
				if (itemFlat.type) item.type = itemFlat.type;
				const itemFields = toFields(prop.items, seen, depth + 1);
				if (itemFields.length > 0) item.properties = itemFields;
				field.items = item;
			} else if (prop.type === "object" && prop.properties) {
				const nested = toFields(prop, seen, depth + 1);
				if (nested.length > 0) field.properties = nested;
			}
		}
		fields.push(field);
	}
	return fields;
}

function extractParameters(op: Json): MinimalParameter[] | undefined {
	const params = Array.isArray(op.parameters) ? op.parameters : [];
	const result: MinimalParameter[] = [];
	for (const raw of params) {
		const p = resolveRef(raw, new Set());
		if (p?.in !== "query") continue;
		const param: MinimalParameter = {
			name: p.name,
			required: !!p.required,
			type: p.schema?.type ?? "string",
		};
		if (Array.isArray(p.schema?.enum)) param.enum = p.schema.enum;
		const desc = cleanDescription(p.description);
		if (desc) param.description = desc;
		result.push(param);
	}
	return result.length > 0 ? result : undefined;
}

function extractRequestBody(op: Json): MinimalRequestBody | undefined {
	const schema = op.requestBody?.content?.["application/json"]?.schema;
	if (!schema) return undefined;
	const properties = toFields(schema, new Set(), 0);
	if (properties.length === 0) return undefined;
	const flat = flatten(schema, new Set());
	const required = Array.isArray(flat.required)
		? flat.required.filter((r: string) => properties.some((p) => p.name === r))
		: [];
	const body: MinimalRequestBody = { properties };
	if (required.length > 0) body.required = required;
	return body;
}

async function loadSpec(inputPath?: string): Promise<Json> {
	if (inputPath) return JSON.parse(readFileSync(inputPath, "utf-8"));
	const res = await fetch(SPEC_URL);
	if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
	return await res.json();
}

async function main() {
	spec = await loadSpec(process.argv[2]);
	const paths = spec.paths ?? {};

	const minimal: MinimalSchema = {
		version: spec.info?.version ?? "unknown",
		paths: {},
	};

	for (const [path, methods] of Object.entries(paths)) {
		const normalizedPath = `/v1${path.startsWith("/") ? path : `/${path}`}`;
		minimal.paths[normalizedPath] = {};

		for (const [method, op] of Object.entries(methods as Record<string, Json>)) {
			if (!METHODS.has(method)) continue;
			const entry: MinimalOperation = { summary: op.summary ?? "" };
			const parameters = extractParameters(op);
			if (parameters) entry.parameters = parameters;
			const requestBody = extractRequestBody(op);
			if (requestBody) entry.requestBody = requestBody;
			minimal.paths[normalizedPath][method.toUpperCase()] = entry;
		}
	}

	const json = JSON.stringify(minimal, null, "\t");
	writeFileSync(OUTPUT_PATH, `${json}\n`);

	const pathCount = Object.keys(minimal.paths).length;
	let opCount = 0;
	let bodyCount = 0;
	for (const methods of Object.values(minimal.paths)) {
		for (const op of Object.values(methods)) {
			opCount++;
			if (op.requestBody) bodyCount++;
		}
	}
	console.log(
		`Generated: ${pathCount} paths, ${opCount} operations, ${bodyCount} with requestBody`,
	);
	console.log(`Output: ${OUTPUT_PATH} (${Buffer.byteLength(json)} bytes)`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
