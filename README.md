# Goal Reminder Bot

Slackの毎週月曜日の目標投稿スレッドから返信を集め、火曜日から日曜日まで毎朝8:00 JSTにチャンネルへリマインドを投稿します。

## 動作

- 対象チャンネル: `C0AUQNCULMB`
- 月曜投稿の判定文: `今週の目標をスレッドに投稿してください`
- 実行時刻: 火曜日から日曜日の 08:00 JST
- 投稿先: チャンネルへの新規投稿
- 投稿形式:

```text
<@U123> 今週の目標は「〇〇する」です
<@U456> 今週の目標は「〇〇する」です
<@U789> 今週の目標は「〇〇する」です
```

同じ日に同じリマインド本文がすでに投稿されている場合は再投稿しません。

## GitHub Secrets

リポジトリの `Settings` -> `Secrets and variables` -> `Actions` に以下を登録してください。

| Name | Value |
| --- | --- |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |

## Slack Appに必要な権限

Bot Token Scopes:

- `chat:write`
- `channels:history`
- `channels:read`

Botを対象チャンネル `C0AUQNCULMB` に招待してください。

## 手動テスト

GitHub Actionsの `Goal reminder` workflowを手動実行し、`dry_run` に `true` を指定するとSlackには投稿せず、生成される本文だけをログに出します。

ローカルで構文とユニットテストだけ確認する場合:

```bash
npm test
```
