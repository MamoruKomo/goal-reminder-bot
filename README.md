# Goal Reminder Bot

Slackの毎週月曜日の目標投稿スレッドから返信を集め、火曜日から日曜日まで毎朝8:00 JSTにチャンネルへリマインドを投稿します。
火曜日のリマインド時には、読み込んだ目標をNotionのToDoデータベースにも追加します。

## 動作

- 対象チャンネル: `C0AUQNCULMB`
- 月曜投稿の判定文: `今週の目標をスレッドに投稿してください`
- 実行時刻: 火曜日から日曜日の 08:00 JST
- 投稿先: チャンネルへの新規投稿
- Notion追加: 火曜日のリマインド時のみ、ToDoデータベースに1人1件ずつ追加
- 投稿形式:

```text
<@U123> 今週の目標は「〇〇する」です
<@U456> 今週の目標は「〇〇する」です
<@U789> 今週の目標は「〇〇する」です
```

同じ日に同じリマインド本文がすでに投稿されている場合は再投稿しません。
Notion側は、同じタイトルと同じ期限日のToDoがある場合は再作成しません。

## GitHub Secrets

リポジトリの `Settings` -> `Secrets and variables` -> `Actions` に以下を登録してください。

| Name | Value |
| --- | --- |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `NOTION_TOKEN` | Notion Internal Integration Secret (`ntn_...`) |

`NOTION_TOKEN` が未設定の場合、Slackリマインドだけ実行し、Notion追加はスキップします。

## Slack Appに必要な権限

Bot Token Scopes:

- `chat:write`
- `channels:history`
- `channels:read`

Botを対象チャンネル `C0AUQNCULMB` に招待してください。

## Notion設定

対象データベース:

```text
ToDo: 39509a68050b80ff8bc0e7e49996c330
Data source: 39509a68-050b-80a0-966f-000ba6c187f4
```

Notionのインテグレーションを作成し、対象のToDoデータベースで `Add connections` からそのインテグレーションを追加してください。

必要なCapabilities:

- Read content
- Insert content

作成されるToDo:

- `やること`: `今週の目標: 〇〇する`
- `ステータス`: `まだ手つけてないよ`
- `種別`: `その他`
- `いつまでにやるの？`: その週の日曜日

## 手動テスト

GitHub Actionsの `Goal reminder` workflowを手動実行し、`dry_run` に `true` を指定するとSlackには投稿せず、生成される本文だけをログに出します。
Slackのスレッド返信取得は、近年作成されたSlackアプリの制限に合わせて1回15件まで取得します。3人分の目標返信には十分です。

ローカルで構文とユニットテストだけ確認する場合:

```bash
npm test
```
