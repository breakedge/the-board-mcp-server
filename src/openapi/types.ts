export interface MinimalParameter {
	name: string;
	required: boolean;
	type: string;
}

export interface MinimalOperation {
	summary: string;
	parameters?: MinimalParameter[];
}

// key は HTTP メソッド (GET, POST, PATCH, DELETE)
export interface MinimalPath {
	[method: string]: MinimalOperation;
}

export interface MinimalSchema {
	version: string;
	paths: Record<string, MinimalPath>;
}
