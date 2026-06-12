export interface MinimalParameter {
	name: string;
	required: boolean;
	type: string;
	/** 取り得る値 (OpenAPI の enum)。describe 出力でのみ提示する。 */
	enum?: (string | number)[];
	/** パラメータ説明 (切り詰め済み)。describe 出力でのみ提示する。 */
	description?: string;
}

/** requestBody / ネストオブジェクトのフィールド定義。 */
export interface MinimalField {
	name: string;
	type?: string;
	required?: boolean;
	enum?: (string | number)[];
	description?: string;
	/** type === "object" のときのネストプロパティ。 */
	properties?: MinimalField[];
	/** type === "array" のときの要素スキーマ。 */
	items?: { type?: string; properties?: MinimalField[] };
}

export interface MinimalRequestBody {
	required?: string[];
	properties: MinimalField[];
}

export interface MinimalOperation {
	summary: string;
	parameters?: MinimalParameter[];
	requestBody?: MinimalRequestBody;
}

// key は HTTP メソッド (GET, POST, PATCH, DELETE)
export interface MinimalPath {
	[method: string]: MinimalOperation;
}

export interface MinimalSchema {
	version: string;
	paths: Record<string, MinimalPath>;
}
