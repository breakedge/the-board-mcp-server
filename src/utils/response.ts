import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TheBoardApiError } from "../api/types.js";

export function createTextResponse(text: string): CallToolResult {
	return {
		content: [{ type: "text", text }],
	};
}

export function createErrorResponse(message: string): CallToolResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
	};
}

function extractValidationDetails(body: unknown): string {
	if (body && typeof body === "object") {
		const b = body as Record<string, unknown>;
		if (b.errors && typeof b.errors === "object") {
			const errors = b.errors as Record<string, unknown>;
			// Board API は errors の値を配列 / 文字列 / オブジェクトいずれでも返しうるため
			// 形に依存せず文字列化する (配列前提の messages.join はクラッシュする)
			const details = Object.entries(errors)
				.map(([field, messages]) => {
					const text = Array.isArray(messages)
						? messages.join(", ")
						: typeof messages === "string"
							? messages
							: JSON.stringify(messages);
					return `${field}: ${text}`;
				})
				.join("; ");
			return details ? ` (${details})` : "";
		}
	}
	return "";
}

export function formatApiError(error: unknown): string {
	if (error instanceof TheBoardApiError) {
		switch (error.status) {
			case 400:
				return "リクエストが不正です (400)";
			case 401:
				return "認証に失敗しました。API キーとトークンを確認してください。";
			case 403:
				return "このリソースへのアクセス権限がありません。";
			case 404:
				return "リソースが見つかりませんでした。";
			case 422:
				return `入力値が正しくありません。${extractValidationDetails(error.body)}`;
			case 429:
				return "レート制限に達しました。しばらく待ってから再試行してください。";
			case 500:
			case 503:
				return "Board API でエラーが発生しました。時間をおいて再試行してください。";
			default:
				return `API エラーが発生しました (${error.status})`;
		}
	}
	return "予期しないエラーが発生しました。";
}
