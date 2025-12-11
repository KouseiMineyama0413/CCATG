# Claude Code Agent Team Generator (CCATG)

言語: 日本語 | [English](README.md)

Claude Code のサブエージェントをテンプレートからまとめて生成する開発者向け CLI です。`.claude/agents/*.md` の作成と、`claude --agents` に渡す JSON を同じテンプレから生成できます。

## セットアップ
- Node.js 18+ を想定
- 依存インストール: `npm install`
- ビルド: `npm run build`（`dist/` にコンパイルされた CLI が出ます）
- ショートカット: `npm run link:local`（ビルドして `npm link`）で PATH に `ccatg` を登録できます。以降は `ccatg --help` で利用可能。直接実行したい場合は `node dist/index.js ...` でも呼び出せます。
- `run-with-agents` サブコマンドを使う場合は `claude` CLI が PATH に必要です。

## 主要コマンド
- テンプレ一覧: `node dist/index.js list-templates`
- テンプレ詳細表示: `node dist/index.js show-template --template web-product-team`（`--json` で生 JSON）
- Markdown 生成: `node dist/index.js generate-files --template web-product-team --scope project`
  - `--scope project` で `./.claude/agents/`、`--scope user` で `~/.claude/agents/` に `<name>.md` を生成します。
- JSON 出力: `node dist/index.js agents-json --template bugfix-incident-team`  
  例: `claude --agents "$(node dist/index.js agents-json --template bugfix-incident-team)" -p "調査タスク"`
- Claude 実行: `node dist/index.js run-with-agents --template web-product-team --prompt "今回のタスク"`  
  内部で `claude --agents '<JSON>' -p '<prompt>'` を実行します。

## 内蔵テンプレート
- `web-product-team`: 新機能開発用の設計/実装/レビュー/テスト/ドキュメント担当セット
- `bugfix-incident-team`: 障害トリアージ・調査・修正・ポストモーテム担当セット
- `library-maintainer-team`: API 設計、実装、セキュリティレビュー、ドキュメント、リリース担当セット

## テンプレートの差し替え/追加 (YAML)
- 読み込み優先度（下が高優先）：`templates/` (同梱) < `~/.ccatg/org-templates/` < `./.ccatg/templates/` < `CCATG_TEMPLATES_DIR`（環境変数で最優先ディレクトリを指定）
- 追加/上書きは YAML を置き換えるだけで反映されます（再ビルド不要）。
- 追加例: `templates/my-team.yml` を置くと `list-templates` に表示され、`--template my-team` で利用できます。`list-templates --with-source` でどの YAML が参照されているか確認できます。
- フォーマット例:
  ```yaml
  id: my-team
  label: My Custom Team
  description: 好きな説明文
  agents:
    - name: foo
      description: Foo agent
      model: sonnet
      permissionMode: plan
      tools: [Read, Grep, Glob]
      skills: [frontend, api]
      promptTemplate: >-
        You are Foo...
    - name: bar
      description: Bar agent
      promptTemplate: >-
        You are Bar...
  ```

## データモデル概要
- `TeamTemplate`: `id`, `label`, `description`, `agents[]`（各エージェントの `name`, `description`, `model`, `permissionMode`, `tools`, `skills`, `promptTemplate`）
- `SubAgentSpec`: `TeamTemplate` をスコープ付き（`project` or `user`）でマッピングしたもの。`systemPrompt` が実際の Markdown/JSON に入る本文。
- 生成される Markdown:
  ```
  ---
  name: <name>
  description: <description>
  tools: Read, Grep, ...
  model: sonnet
  permissionMode: plan
  skills: ...
  templateId: <template id>
  templateVersion: <optional version>
  generatedAt: 2025-12-11T10:00:00.000Z
  ---
  <systemPrompt>
  ```
- JSON (`claude --agents` 用): `{ "<name>": { description, prompt, tools?, model? }, ... }`

## 生成ファイルの上書き安全性
- 既存ファイルを上書きしないようにデフォルトでチェックします。上書きしたい場合は `generate-files --force` を指定してください。

## ディレクトリ構成と実行前提
本ツールは各プロジェクトの root 直下に `ccatg/` ディレクトリとして配置し、プロジェクト root をカレントディレクトリにして実行します。

### 想定ディレクトリ構成
```
project-root/
  ccatg/                # 本ツール（Node.js / TypeScript プロジェクト）
    package.json
    tsconfig.json
    src/
      index.ts          # CLI エントリポイント
      ...
  src/                  # プロジェクト本体
  .claude/              # Claude Code 用設定（無い場合はツールが作成）
  ...
```
- `project-root` が Claude Code を使いたいコードベースの root。
- `ccatg/` はプロジェクト専用ツールとして同居させる。

### 実行パスの前提
- 常に `project-root` をカレントディレクトリとして `node ./ccatg/dist/index.js ...` を叩く想定（ビルド後）。
- 将来的に `package.json` の `bin` 登録で `./ccatg/ccatg` を叩く形にしてもよいが、現状は `node ./ccatg/dist/index.js ...` 前提で記載。

#### 実行例（project-root から）
```
node ./ccatg/dist/index.js list-templates
node ./ccatg/dist/index.js show-template --id web-product-team
node ./ccatg/dist/index.js generate-files --template web-product-team --scope project
node ./ccatg/dist/index.js print-agents-json --template bugfix-incident-team
node ./ccatg/dist/index.js run-with-agents --template bugfix-incident-team --prompt "このログから原因を特定して、修正方針を提案して"
# 未来のオプション機能
# node ./ccatg/dist/index.js analyze-repo --path . --output suggestion.yml
```

### .claude/agents の出力パス
- `generate-files` は `process.cwd()`（= project-root）基準で出力します。
- scope が `project` の場合、常に `project-root/.claude/agents/` に `<name>.md` を生成します。

### template の rootDir フィールド
- 各 TeamTemplate の YAML に `rootDir` を指定すると、そのディレクトリを project root として扱います（相対パスは実行時のカレントディレクトリから解決）。
- デフォルトは `process.cwd()` です。`ccatg` をサブディレクトリに置く運用でも、テンプレート側で `rootDir: ..` などを指定してプロジェクト root を指せます。

### 追加の CLI 機能
- バリデーション: `node ./ccatg/dist/index.js validate-templates`（`--allow-missing-root` で rootDir の存在チェックを緩和）
- 生成前プレビュー: `generate-files --dry-run` で生成/上書き予定とフロントマターを表示
- rootDir の一時上書き: `generate-files --root-dir apps/admin`（テンプレの rootDir を無視してこのパスを使用）
- 部分生成: `--only architect,implementer` / `--except doc-writer`
- 名前衝突回避: `--prefix web-` でファイル名/agent名に prefix を付与
- 生成済みチェック: `node ./ccatg/dist/index.js check-agents --template web-product-team` で .claude/agents とテンプレ差分を確認

## 開発メモ
- 追加テンプレートは `src/templates.ts` に追記するだけで CLI に反映されます。
- `src/generator.ts` に Markdown/JSON 生成ロジック、`src/index.ts` に CLI 定義があります。
- テンプレやロジックを変更したら `npm run build` で再コンパイルしてください。
