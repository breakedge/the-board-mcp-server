export interface MinimalParameter {
	name: string;
	required: boolean;
	type: string;
	/** 取り得る値 (OpenAPI の enum、または説明文の「- 1：ラベル」列挙から構造化したもの)。 */
	enum?: (string | number)[];
	/** enum 値 → 日本語ラベル (例 {"1": "未請求"})。 */
	enumLabels?: Record<string, string>;
	/** パラメータ説明 (ノイズ除去・切り詰め済み)。 */
	description?: string;
}

/** requestBody / ネストオブジェクトのフィールド定義。 */
export interface MinimalField {
	name: string;
	type?: string;
	/** OpenAPI の format (date, date-time, int32, decimal 等)。 */
	format?: string;
	required?: boolean;
	enum?: (string | number)[];
	enumLabels?: Record<string, string>;
	description?: string;
	/** type === "object" のときのネストプロパティ。 */
	properties?: MinimalField[];
	/** type === "array" のときの要素スキーマ。 */
	items?: { type?: string; properties?: MinimalField[] };
}

/** requestBody の共通部分 (variant を持つ operation では共通フィールドのみ)。 */
export interface MinimalRequestBody {
	required?: string[];
	properties: MinimalField[];
}

/** anyOf/oneOf の title 付き分岐 (例: 一括請求 / 定期請求 / 分割請求)。共通部分は含まない。 */
export interface MinimalVariant {
	title: string;
	required?: string[];
	properties: MinimalField[];
}

/** 200 応答のフィールド (describe の part=response 用)。ネストは 1 段まで。 */
export interface MinimalResponseField {
	name: string;
	type?: string;
	description?: string;
	enumLabels?: Record<string, string>;
	properties?: MinimalResponseField[];
}

export interface MinimalOperation {
	summary: string;
	parameters?: MinimalParameter[];
	requestBody?: MinimalRequestBody;
	variants?: MinimalVariant[];
	responseFields?: MinimalResponseField[];
}

// key は HTTP メソッド (GET, POST, PATCH, DELETE)
export interface MinimalPath {
	[method: string]: MinimalOperation;
}

export interface MinimalSchema {
	/** 生成形式の版。2 = variants / enumLabels / responseFields を持つ。 */
	schemaVersion?: number;
	/** board API の版 (spec の info.version)。 */
	version: string;
	paths: Record<string, MinimalPath>;
}
