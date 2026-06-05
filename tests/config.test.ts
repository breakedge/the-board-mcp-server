import { getConfig } from "../src/config.js";

describe("getConfig()", () => {
	it("デフォルトで readOnly が true であること", () => {
		const config = getConfig([]);
		expect(config.readOnly).toBe(true);
	});

	it("デフォルトで enableWrites が false であること", () => {
		const config = getConfig([]);
		expect(config.enableWrites).toBe(false);
	});

	it("デフォルトで enableDestructiveWrites が false であること", () => {
		const config = getConfig([]);
		expect(config.enableDestructiveWrites).toBe(false);
	});

	it("デフォルトで toolsets が全ツールセットを含むこと", () => {
		const config = getConfig([]);
		expect(config.toolsets).toBeDefined();
		expect(Array.isArray(config.toolsets)).toBe(true);
		expect(config.toolsets.length).toBeGreaterThan(0);
	});

	it('["--enable-writes"] を渡すと enableWrites が true になること', () => {
		const config = getConfig(["--enable-writes"]);
		expect(config.enableWrites).toBe(true);
	});

	it('["--enable-destructive-writes"] を渡すと enableDestructiveWrites が true になり enableWrites も暗黙的に true になること', () => {
		const config = getConfig(["--enable-destructive-writes"]);
		expect(config.enableDestructiveWrites).toBe(true);
		expect(config.enableWrites).toBe(true);
	});

	it('["--toolsets", "projects,documents"] を渡すと toolsets が ["projects", "documents"] になること', () => {
		const config = getConfig(["--toolsets", "projects,documents"]);
		expect(config.toolsets).toEqual(["projects", "documents"]);
	});

	it("環境変数 THE_BOARD_READ_ONLY=false が反映されること", () => {
		vi.stubEnv("THE_BOARD_READ_ONLY", "false");
		const config = getConfig([]);
		expect(config.readOnly).toBe(false);
		vi.unstubAllEnvs();
	});

	it("環境変数 THE_BOARD_ENABLE_WRITES=true が反映されること", () => {
		vi.stubEnv("THE_BOARD_ENABLE_WRITES", "true");
		const config = getConfig([]);
		expect(config.enableWrites).toBe(true);
		vi.unstubAllEnvs();
	});

	it('"--read-only --enable-writes" を渡すと明示 --read-only が優先され (fail-closed) readOnly=true・書き込み無効になること', () => {
		const config = getConfig(["--read-only", "--enable-writes"]);
		expect(config.readOnly).toBe(true);
		expect(config.enableWrites).toBe(false);
		expect(config.enableDestructiveWrites).toBe(false);
	});

	it("環境変数 THE_BOARD_ENABLE_WRITES=true でも明示 --read-only が優先され readOnly=true・書き込み無効になること (fail-closed)", () => {
		vi.stubEnv("THE_BOARD_ENABLE_WRITES", "true");
		const config = getConfig(["--read-only"]);
		expect(config.readOnly).toBe(true);
		expect(config.enableWrites).toBe(false);
		vi.unstubAllEnvs();
	});

	it("不正なツールセット名が除外されること", () => {
		const config = getConfig(["--toolsets", "projects,invalid,documents"]);
		expect(config.toolsets).toEqual(["projects", "documents"]);
	});

	it("環境変数 THE_BOARD_TOOLSETS が反映されること", () => {
		vi.stubEnv("THE_BOARD_TOOLSETS", "projects,payees");
		const config = getConfig([]);
		expect(config.toolsets).toEqual(["projects", "payees"]);
		vi.unstubAllEnvs();
	});

	it("--toolsets フラグが環境変数 THE_BOARD_TOOLSETS より優先されること", () => {
		vi.stubEnv("THE_BOARD_TOOLSETS", "projects,payees");
		const config = getConfig(["--toolsets", "documents"]);
		expect(config.toolsets).toEqual(["documents"]);
		vi.unstubAllEnvs();
	});
});
