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
 *   npx biome format --write openapi/the-board.minimal.json   # 生成後に必須
 *
 * input-path を省略した場合、公式 URL からダウンロードする。
 * 出力 JSON は素の JSON.stringify(tab) で、コミット済みファイルは biome で整形済み。
 * 再生成したら biome format を必ず通すこと (整形差分でレビューが埋もれるのを防ぐ)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
	format?: string;
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

/** $ref を解決する (循環は null を返す)。seen は呼び出し側のパス集合を直接変更する。 */
function resolveRef(node: Json, seen: Set<string>): Json {
	let current = node;
	while (current && typeof current === "object" && typeof current.$ref === "string") {
		if (seen.has(current.$ref)) return null;
		seen.add(current.$ref);
		const path = current.$ref.replace(/^#\//, "").split("/");
		let target: Json = spec;
		// JSON Pointer のエスケープ (~1 → /, ~0 → ~) を解いてから辿る
		for (const key of path) {
			target = target?.[decodeURIComponent(key).replace(/~1/g, "/").replace(/~0/g, "~")];
		}
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

const MAX_FLATTEN_DEPTH = 50;

/**
 * allOf を平坦化し、{type, properties, required, enum, readOnly, items, description} を返す。
 * seen は「現在の解決パス上の $ref 集合」。resolveRef がパスに沿って ref を蓄積し、
 * 兄弟(別 allOf 分岐)へは copy を渡すことで、循環を検出しつつ兄弟間の重複参照は許容する。
 * depth backstop は ref を介さない病的に深い allOf への保険。
 */
export function flatten(schema: Json, seen: Set<string>, depth = 0): Json {
	if (depth > MAX_FLATTEN_DEPTH) return {};
	const path = new Set(seen);
	const resolved = resolveRef(schema, path);
	if (!resolved || typeof resolved !== "object") return {};
	if (Array.isArray(resolved.allOf)) {
		const merged: Json = { type: "object", properties: {}, required: [] as string[] };
		// allOf と同階層のメタ情報 (required/properties/enum/readOnly) も取り込む
		if (Array.isArray(resolved.required)) merged.required.push(...resolved.required);
		if (resolved.properties) Object.assign(merged.properties, resolved.properties);
		if (Array.isArray(resolved.enum)) merged.enum = resolved.enum;
		if (resolved.readOnly === true) merged.readOnly = true;
		for (const part of resolved.allOf) {
			const flat = flatten(part, path, depth + 1);
			if (flat.type && flat.type !== "object") merged.type = flat.type;
			Object.assign(merged.properties, flat.properties ?? {});
			if (Array.isArray(flat.required)) merged.required.push(...flat.required);
			if (flat.items) merged.items = flat.items;
			if (Array.isArray(flat.enum) && !merged.enum) merged.enum = flat.enum;
			if (flat.readOnly === true) merged.readOnly = true;
			if (flat.format && !merged.format) merged.format = flat.format;
			if (flat.description && !merged.description) merged.description = flat.description;
		}
		return merged;
	}
	// oneOf/anyOf は相互排他な分岐だが、describe では全候補のフィールドを提示したいので、
	// 先頭(基底)分岐の type/required/enum を維持しつつ、後続分岐の properties を union する。
	// 例: POST /projects は請求形態別の anyOf で、基底分岐に共通フィールド+必須、後続分岐に
	// invoice_dates / periodical_invoice_* / contract_* が分かれて入る。先頭のみだと脱落する。
	const variants = resolved.oneOf ?? resolved.anyOf;
	if (Array.isArray(variants) && variants.length > 0) {
		const flats = variants.map((v) => flatten(v, path, depth + 1));
		const base = flats[0];
		// properties を持たない分岐 (スカラ等) は先頭候補のみ採用 (従来挙動)。
		if (!base || typeof base !== "object" || !base.properties) return base;
		// base は spec ノード参照の可能性があるため、properties は複製してから統合する。
		const merged: Json = { ...base, properties: { ...base.properties } };
		for (let i = 1; i < flats.length; i++) {
			if (flats[i]?.properties) Object.assign(merged.properties, flats[i].properties);
		}
		return merged;
	}
	return resolved;
}

/** スキーマのプロパティ集合を MinimalField[] に変換 (depth 制限・readOnly 除外)。 */
export function toFields(schema: Json, seen: Set<string>, depth: number): MinimalField[] {
	const flat = flatten(schema, seen);
	const props = flat.properties as Record<string, Json> | undefined;
	if (!props) return [];
	const requiredSet = new Set<string>(Array.isArray(flat.required) ? flat.required : []);
	const fields: MinimalField[] = [];
	for (const [name, rawProp] of Object.entries(props)) {
		const prop = flatten(rawProp, seen);
		if (prop.readOnly === true) continue; // 書き込みボディに設定不可
		const field: MinimalField = { name };
		// type を省く spec でも items/properties の有無で配列/オブジェクトを補う
		if (prop.type) {
			field.type = prop.type;
		} else if (prop.items) {
			field.type = "array";
		} else if (prop.properties) {
			field.type = "object";
		}
		// format (date / date-time / int32 等) は describe で AI が値の形を掴むのに有用
		if (typeof prop.format === "string") field.format = prop.format;
		if (requiredSet.has(name)) field.required = true;
		if (Array.isArray(prop.enum)) field.enum = prop.enum;
		const desc = cleanDescription(prop.description);
		if (desc) field.description = desc;
		// type 文字列を省く spec もあるため、items/properties の有無で配列/オブジェクトを判定する
		if (depth < MAX_DEPTH) {
			if (prop.items) {
				const itemFlat = flatten(prop.items, seen);
				const item: { type?: string; properties?: MinimalField[] } = {};
				if (itemFlat.type) item.type = itemFlat.type;
				const itemFields = toFields(prop.items, seen, depth + 1);
				if (itemFields.length > 0) item.properties = itemFields;
				field.items = item;
			} else if (prop.properties) {
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

export function extractRequestBody(op: Json): MinimalRequestBody | undefined {
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

// スクリプトとして直接実行されたときだけ生成を走らせる。
// テストから import する際に副作用 (spec の fetch / ファイル書き込み) を防ぐ。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
