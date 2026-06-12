import yargs from "yargs";

export const ALL_TOOLSETS = [
	"projects",
	"documents",
	"customers",
	"payees",
	"expenditures",
	"master",
	"analytics",
] as const;

export type Toolset = (typeof ALL_TOOLSETS)[number];

export interface Config {
	readOnly: boolean;
	enableWrites: boolean;
	enableDestructiveWrites: boolean;
	toolsets: Toolset[];
}

export function getConfig(argv: string[] = process.argv.slice(2)): Config {
	const parsed = yargs(argv)
		.option("read-only", {
			type: "boolean",
			default: undefined,
			description: "Only allow GET requests",
		})
		.option("enable-writes", {
			type: "boolean",
			default: false,
			description: "Allow POST and PATCH requests",
		})
		.option("enable-destructive-writes", {
			type: "boolean",
			default: false,
			description: "Allow DELETE and irreversible operations",
		})
		.option("toolsets", {
			type: "string",
			description: "Comma-separated list of enabled toolsets",
		})
		.parseSync();

	const envReadOnly = process.env.THE_BOARD_READ_ONLY;
	const envEnableWrites = process.env.THE_BOARD_ENABLE_WRITES;
	const envEnableDestructiveWrites = process.env.THE_BOARD_ENABLE_DESTRUCTIVE_WRITES;

	const explicitReadOnly = parsed["read-only"] === true;

	let enableDestructiveWrites = parsed["enable-destructive-writes"] as boolean;
	if (envEnableDestructiveWrites === "true") {
		enableDestructiveWrites = true;
	}

	let enableWrites = parsed["enable-writes"] as boolean;
	if (envEnableWrites === "true") {
		enableWrites = true;
	}
	// --enable-destructive-writes implies --enable-writes
	if (enableDestructiveWrites) {
		enableWrites = true;
	}

	let readOnly: boolean;
	if (parsed["read-only"] !== undefined) {
		readOnly = parsed["read-only"] as boolean;
	} else if (envReadOnly !== undefined) {
		readOnly = envReadOnly !== "false";
	} else {
		readOnly = true;
	}

	// 明示的な --read-only (CLI) は最優先の安全フラグ:
	// env / write フラグに勝って read-only を強制し、書き込みを無効化する (fail-closed)。
	if (explicitReadOnly) {
		readOnly = true;
		enableWrites = false;
		enableDestructiveWrites = false;
	} else if (enableWrites || enableDestructiveWrites) {
		// 書き込みが有効なら read-only ではない
		readOnly = false;
	}

	// --toolsets フラグ優先、なければ環境変数 THE_BOARD_TOOLSETS、どちらもなければ全有効
	const toolsetsRaw = (parsed.toolsets as string | undefined) ?? process.env.THE_BOARD_TOOLSETS;
	let toolsets: Toolset[];
	if (toolsetsRaw) {
		const requested = toolsetsRaw.split(",").map((s) => s.trim());
		toolsets = requested.filter((s): s is Toolset => {
			if ((ALL_TOOLSETS as readonly string[]).includes(s)) {
				return true;
			}
			console.error(`Warning: unknown toolset "${s}" ignored. Valid: ${ALL_TOOLSETS.join(", ")}`);
			return false;
		});
	} else {
		toolsets = [...ALL_TOOLSETS];
	}

	return {
		readOnly,
		enableWrites,
		enableDestructiveWrites,
		toolsets,
	};
}
