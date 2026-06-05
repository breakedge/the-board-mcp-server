# コントリビューションガイド — The Board MCP Server

ご関心をお寄せいただきありがとうございます！

## 貢献の方法

### バグ報告・機能要望

適切なテンプレートを使って [issue](https://github.com/breakedge/the-board-mcp-server/issues) を作成してください。

### プルリクエストのポリシー

> **重要**: 現時点では外部からのプルリクエストは受け付けていません。

ソロメンテナンスのプロジェクトとして持続可能な運用を維持するため、issue ベースのコントリビューションモデルを採用しています:

- 外部 PR は自動的にクローズされます
- PR の内容は検討用の issue に変換されます
- 実装の判断とコード変更は社内で行います

これにより、次のことを実現しています:

- 一貫したコード品質とアーキテクチャの維持
- レビュー負担を管理可能な範囲に保つ
- issue ベースの開発を通じてコミュニティのニーズに対応する

### 協力していただけること

- 詳細な再現手順とともにバグを報告する
- issue で機能を提案する
- ユースケースを共有して優先順位付けに協力する
- リポジトリに Star を付けて応援する

## 開発環境のセットアップ

```bash
git clone https://github.com/breakedge/the-board-mcp-server.git
cd the-board-mcp-server
npm install
cp .env.example .env  # 認証情報を設定
```

### コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバを起動 |
| `npm test` | テストを実行 |
| `npm run test:cov` | カバレッジ付きでテストを実行 |
| `npm run check` | Lint とフォーマットのチェック |
| `npm run check:fix` | Lint とフォーマットの自動修正 |
| `npm run typecheck` | 型チェック |
| `npm run build` | ビルド |

### テスト

API のモックに [MSW](https://mswjs.io/) を用いた [Vitest](https://vitest.dev/) を使用しています。

```bash
npm test           # 全テストを実行
npm run test:cov   # カバレッジレポート付き
```

## 行動規範

本プロジェクトは [Contributor Covenant](CODE_OF_CONDUCT.md) に従います。
