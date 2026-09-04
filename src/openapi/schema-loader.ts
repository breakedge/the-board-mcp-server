import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MinimalOperation, MinimalSchema } from "./types.js";

export function sanitizePath(path: string): string {
	if (path.length === 0) {
		throw new Error("Path must not be empty");
	}
	if (/[\r\n]/.test(path)) {
		throw new Error("Path must not contain CRLF characters");
	}
	// パーセントエンコーディングを拒否（%2e%2e / %2f / %0d%0a 等のエンコード済みトラバーサル・CRLF 対策）
	// 正規の API パスにエンコードは不要。query パラメータは別経路 (query object) で渡す。
	if (path.includes("%")) {
		throw new Error("Path must not contain percent-encoding");
	}
	// 多重スラッシュ正規化
	const normalized = path.replace(/\/+/g, "/");
	if (normalized.split("/").includes("..")) {
		throw new Error("Path must not contain '..' segments");
	}
	if (!normalized.startsWith("/v1/") && normalized !== "/v1") {
		throw new Error("Path must start with /v1/");
	}
	// 末尾スラッシュ除去
	return normalized.replace(/\/$/, "");
}

export async function loadSchema(): Promise<MinimalSchema> {
	const schemaPath = fileURLToPath(
		new URL("../../openapi/the-board.minimal.json", import.meta.url),
	);
	const content = readFileSync(schemaPath, "utf-8");
	return JSON.parse(content) as MinimalSchema;
}

export function matchPathPattern(path: string, schema: MinimalSchema): string | null {
	// 完全一致チェック
	if (path in schema.paths) {
		return path;
	}
	// パターンマッチ
	// パスパラメータ ({id} 等) は英数字・ハイフンのみ許可。
	// 非準拠の値 (`;` / 空白 / エンコード文字等) はどのパターンにもマッチせず null となる。
	for (const pattern of Object.keys(schema.paths)) {
		const regexStr = pattern
			.split(/\{[^}]+\}/)
			.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("[A-Za-z0-9-]+");
		const regex = new RegExp(`^${regexStr}$`);
		if (regex.test(path)) {
			return pattern;
		}
	}
	return null;
}

export function validatePath(method: string, path: string, schema: MinimalSchema): boolean {
	const pattern = matchPathPattern(path, schema);
	if (pattern === null) {
		return false;
	}
	const pathObj = schema.paths[pattern];
	return method.toUpperCase() in pathObj;
}

/**
 * 指定 method + path の operation が宣言する既知クエリパラメータ名を返す。
 * スキーマに parameters 定義が無い operation は null を返す(検証は fail-open)。
 * minimal schema はクエリパラメータを GET リスト系のみ完全収録しているため、
 * 定義がある場合はそれを権威ある集合として扱える。
 */
export function getKnownQueryParams(
	method: string,
	path: string,
	schema: MinimalSchema,
): Set<string> | null {
	const pattern = matchPathPattern(path, schema);
	if (pattern === null) {
		return null;
	}
	const operation = schema.paths[pattern]?.[method.toUpperCase()];
	if (!operation?.parameters || operation.parameters.length === 0) {
		return null;
	}
	return new Set(operation.parameters.map((p) => p.name));
}

/** method + 具体パスから operation を引く。パターン解決に失敗、または method 非対応なら null。 */
export function getOperation(
	method: string,
	path: string,
	schema: MinimalSchema,
): { pattern: string; operation: MinimalOperation } | null {
	const pattern = matchPathPattern(path, schema);
	if (pattern === null) return null;
	const operation = schema.paths[pattern]?.[method.toUpperCase()];
	return operation ? { pattern, operation } : null;
}
