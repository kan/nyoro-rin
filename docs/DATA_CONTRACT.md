# NYORO-RIN — 問題・履歴データ契約

本書は、問題の表現・保存データ・API・DB が満たすべき契約を定めます。ゲームルールの正本は [`DESIGN.md`](./DESIGN.md) とします。

仕組みは TAKO-SEN（kan/tako-sen の `docs/DATA_CONTRACT.md`）に倣います。TAKO-SEN と違う点は、各節で明記します。

## 盤面の表現

盤面の大きさを `R × C`（通常問題は 7 × 7）とします。

- マス: `r * C + c`（`0 ≤ r < R`、`0 ≤ c < C`）
- 点: `r * (C + 1) + c`（`0 ≤ r ≤ R`、`0 ≤ c ≤ C`）
- 辺: 横の辺を先に、縦の辺を後に番号付けする
  - 横の辺（点 `(r, c)` と `(r, c + 1)` を結ぶ）: `r * C + c`（`0 ≤ r ≤ R`、`0 ≤ c < C`）
  - 縦の辺（点 `(r, c)` と `(r + 1, c)` を結ぶ）: `(R + 1) * C + r * (C + 1) + c`（`0 ≤ r < R`、`0 ≤ c ≤ C`）
  - 7 × 7 では横の辺が 0〜55、縦の辺が 56〜111

この番号は、保存データ・API・テストで共通に使います。描画上の座標や DOM 要素を辺の識別子にしません。

数字は長さ `R * C` の配列で、各要素は `0`〜`3` か `null`（数字なし）です。

正解は、輪に含まれる辺の番号を昇順に並べた配列で持ちます。正解は端末の盤面データには含めますが、公開 API の応答には含めません。

## 問題の同一性と再現

- 表示用のシードコードは `NYORO:<generatorVersion>:<difficulty>:<seed>`。`difficulty` は `easy`・`normal`・`hard`、`seed` は 1〜128 UTF-16 コード単位で、URI エンコードして埋め込む。シードコードは再生成の入力であり、問題 ID ではない
- 最初の Generator の版は `n1`。版を足しても既存の版の生成処理は変えない。版ごとに 3 難易度 × 3 入力の盤面全体のハッシュを固定テストで守る
- 問題 ID は `p1:<SHA-256 hex>`。UTF-8 の正規形 `JSON.stringify(["p1", generatorVersion, size, clues])` から作る。`size` は 1 辺のマス数（7 か 10）、`clues` は上の数字の配列。正解・シード・難易度は含めない
- 問題 ID を作る前に、数字の値域と唯一解を検証する
- 結果の登録で受け付けるシードコードは、前後に空白のないものに限る

## ローカル保存と版

キーはすべて `nyoro-rin.` で始めます。

| キー                         | 内容                                       |
| ---------------------------- | ------------------------------------------ |
| `nyoro-rin.current-game.v1`  | プレイ中の問題と状態                       |
| `nyoro-rin.results.v1`       | クリア履歴（`version: 1`）                 |
| `nyoro-rin.settings.v1`      | 設定                                       |
| `nyoro-rin.difficulty.v1`    | 新しい問題の難易度の選択                   |
| `nyoro-rin.user-id`          | 匿名のローカルユーザー ID                  |
| `nyoro-rin.sync-outbox.v1`   | 未送信の記録（`version: 1`）               |
| `nyoro-rin.play-log.v1`      | プレイ中の試行のプレイログ（`version: 1`） |
| `nyoro-rin.log-outbox.v1`    | 未送信のプレイログ（`version: 1`）         |
| `nyoro-rin.sent-feedback.v1` | 送った感想（`version: 1`、新しい順に 20 件） |
| `nyoro-rin.kan-game-id.v1`   | ID 基盤が最後に確かめた ID（認証情報ではない） |
| `nyoro-rin.account-profile.v1:<ID>` | ID ごとのプレイヤー名と同意の写し（表示用） |

プレイ中の状態には、以下を含めます。

- 問題（シードコード、版、難易度、大きさ、数字、正解）
- `playId`（試行の開始時に作る UUID。ローカルの結果とサーバー送信の冪等キー）
- 線の辺の番号の配列、× の辺の番号の配列
- 元に戻す・やり直すの履歴（各 200 手まで。各手は変わった辺と前後の状態）
- READY・一時停止の状態と計時済みの時間
- ヒント使用回数、ヒントの最大段階、アシストの最大段階、正解の線を直接示した回数

形式は次のとおりです（`version: 1`）。辺の番号の配列は昇順です。

```json
{
  "version": 1,
  "puzzle": {
    "seedCode": "NYORO:n1:easy:...",
    "generatorVersion": "n1",
    "difficulty": "easy",
    "size": 7,
    "clues": [null, 2],
    "solution": [0, 1]
  },
  "lines": [0],
  "crosses": [3],
  "undo": [[[0, 0, 1]]],
  "redo": [],
  "timer": { "status": "ready", "elapsedMs": 0 },
  "playId": "UUID",
  "startedAt": 0,
  "hintsUsed": 0,
  "maxHintStage": 0,
  "maxAssist": 2,
  "reveals": 0
}
```

- `undo` と `redo` は手の配列で、各手は `[辺, 前の状態, 後の状態]` の配列。状態は `0`（未定）・`1`（線）・`2`（×）
- `timer.status` は `ready`（READY・一時停止）か `finished`（クリア済み）。計時中は一時停止として保存し、再読み込みでは READY から再開する。`startedAt` は盤面を表示した日時
- 読み込み時は、正解が数字を満たす輪であること、元に戻す・やり直すの履歴が線と × に矛盾しないこと、盤面が完成していることと `finished` が一致することも確かめる

クリア履歴は `{ version: 1, userId, plays }` です。各要素は `playId`・シードコード・版・難易度・`startedAt`・`status`（`in-progress` か `completed`）を持ちます。`completed` には、上の試行の記録・`completedAt`・`elapsedSeconds` を加えます。`userId` は `nyoro-rin.user-id` と同じ値で、食い違うときは履歴の側を正とします。

設定は `{ assist, showConflicts, tool, sound, haptics }` とします。`assist` は `0`（なし）・`1`（×を自動）・`2`（×＋ガイド）で、初期値は `2` です。`showConflicts` の初期値は `true`、`tool` は `"line"` か `"cross"` で初期値は `"line"` です。

難易度の選択は、JSON の文字列 `"easy"`・`"normal"`・`"hard"`・`"random"` のどれかです（DESIGN.md 13.7）。設定とは別のキーにします。盤面の難易度とは独立していて、盤面・シード・記録には `"random"` を使いません。

自動 × は保存しません（プレイヤーの状態から導くため）。

- 読み込み時は JSON の構造と値域を検証する。壊れた値はゲーム開始を妨げず、新規状態で起動する。破損値を上書きする前に退避する
- 保存形式を変えるときは新しい版のキーを使い、読み込み時に旧版を移行する。移行に成功するまで旧データを削除しない
- `userId` はローカルの匿名 ID であり、kan-game.app の ID や認証情報ではない

## 段階と記録の値

- ヒントの最大段階 `maxHintStage`: 未使用は `0`、通常のヒントは `1`〜`3`（注目箇所・理由・適用）、誤りの絞り込みも `1`〜`3`。表示した最大値を保持し、下げない
- アシストの最大段階 `maxAssist`: `0`〜`2`。試行の中で使った最大値を保持し、下げない。試行の開始時の値は、そのときの設定
- 正解の線を直接示した回数 `reveals`: 0 以上の整数。ヒント使用回数にも含める

TAKO-SEN と違い、ミス数はありません。

## 履歴の同期

- ID を持つ端末で新たにクリアした完了記録を、プレイヤー名の設定前から自動で送信する。ID を持つ前のクリアは後から送信しない。送信後もローカル履歴は削除しない
- サーバーは、認証済みのアカウント ID と `playId` の組を一意に扱う。同じ内容の再送は成功、違う内容の再送は上書きせず `409` を返す
- プレイ中の盤面は同期しない
- 未送信の記録は、アカウント ID と `POST /api/plays` の本文の組として同期キュー（`{ version: 1, pending: [{ accountId, item }] }`）に保存する。本文はクリアした時点の盤面から作る。同じ ID の Cookie を持つあいだだけ送信し、成功するまで保持する。再接続時と 30 秒間隔で再試行する。端末の ID が変わったら、前の ID の未送信記録は捨てる（ローカル履歴には残る）

## API

すべて `/api/` の下に置きます。状態を変える要求（POST・DELETE）は、許可済みの `Origin` を必須とします。応答は `Cache-Control: no-store` とします。

認証は kan-game.app の ID です。Worker は ID の Cookie（ES256 の JWT）の署名を ID 基盤の公開鍵で検証してアカウント ID を取り出し、ID 基盤へは問い合わせません。ローカルの `userId` を認証の根拠にしません。

| API                               | 認証 | 内容                                         |
| --------------------------------- | ---- | -------------------------------------------- |
| `/api/id/*`                       | —    | ID 基盤（`ID` binding）へそのまま中継する    |
| `GET /api/profile`                | ID   | 本人のプレイヤー名と同意の版                 |
| `POST /api/profile`               | ID   | プレイヤー名の登録と公開への同意             |
| `GET /api/plays`                  | ID   | 本人の完了記録（新しい順に最大 500 件）      |
| `POST /api/plays`                 | ID   | 完了記録を 1 件登録する                      |
| `GET /api/leaderboards/:puzzleId` | 不要 | 問題別ランキング                             |
| `POST /api/play-logs`             | ID   | 試行 1 回分のプレイログを登録する            |
| `POST /api/feedback`              | ID   | 感想を 1 件登録する                          |

### `POST /api/plays`

本文:

```json
{
  "playId": "UUID",
  "puzzleId": "p1:...",
  "seedCode": "NYORO:n1:easy:...",
  "generatorVersion": "n1",
  "difficulty": "easy",
  "startedAt": 0,
  "completedAt": 0,
  "elapsedSeconds": 0,
  "hintsUsed": 0,
  "maxHintStage": 0,
  "maxAssist": 2,
  "reveals": 0,
  "loop": [0, 1, 2]
}
```

サーバーは以下を検証します。

- 形式と値域
- シードコードの版と `generatorVersion` が一致すること
- シードコードから盤面を再生成し、問題 ID が `puzzleId` と一致すること
- `loop`（輪の辺の番号）が正解と一致すること

`loop` の照合は TAKO-SEN の通常問題にない検証です。辺の集合を比べるだけで安く、クリアの申告を盤面と照合できます。時間・ヒント・アシストは引き続きクライアントの申告値です。

新規の登録は、アカウントごとに 60 秒の固定窓で 10 件まで。超えたら `429` と `Retry-After: 60` を返します。件数は盤面を再生成して検証する前に数えるので、検証に失敗した送信も数えます（再生成は CPU を使うため）。保存済みの `playId` の再送は、保存した記録と比べて答え、数えません。

成功の応答は `{ status, entries }` です。`entries` は登録した問題のランキングで、`GET /api/leaderboards/:puzzleId` と同じ形です。ランキングの読み取りに失敗しても登録は成功とし、`entries` を省きます。

### プロフィールと公開

- プレイヤー名は kan-game.app 全体で 1 つ。`POST /api/profile` は ID 基盤の `registerName` で名前を登録し、成功した名前と NYORO-RIN の同意を D1 に保存する。別のゲームで名前を設定済みの ID は、その名前を使い、同意だけを求める
- 名前の検証（文字種・長さ・正規化）は TAKO-SEN と同じ規則にする
- ランキングの対象は、同意した時刻（サーバー時刻）以降に完了したクリアだけとする。端末の時計の遅れを 10 分まで許容する
- 名前の設定画面は自動では開かない。名前がなくても遊べる

### 問題別ランキング

- `GET /api/leaderboards/:puzzleId` は未認証でも使える。同じ問題 ID の、各プレイヤーの初回のクリアを最大 100 人返す
- 初回は、アカウント・問題 ID ごとの最初のサーバー登録とする。登録と初回の選択を同じトランザクションで行い、同時の送信でも 1 件だけを選ぶ。再挑戦は個人の履歴には残すが、初回を置き換えない
- 順位は [`DESIGN.md`](./DESIGN.md) 16.2 のスコアの降順、同点ならクリア時間・ヒント使用回数の昇順。すべて同じなら同順位（1、1、3）
- 応答の各行は `{ rank, displayName, elapsedSeconds, hintsUsed, maxHintStage, maxAssist, isSelf }` だけとする。アカウント ID・ローカル ID・`playId`・日時・正解は含めない。`isSelf` は Cookie があるときだけ真になりうる

### プレイログ

[`DESIGN.md`](./DESIGN.md) 20.1 のプレイログです。形式の正本は `src/core/play-log.ts` です。

端末は、プレイ中の試行のログを `nyoro-rin.play-log.v1` に `{ version: 1, playId, events, truncated }` として持ちます。`playId` がプレイ中の状態と違うログは読み捨てます。試行が終わったら `POST /api/play-logs` の本文を作り、未送信のプレイログ（`nyoro-rin.log-outbox.v1`、同期キューと同じ形、20 件まで）に入れて送ります。

`POST /api/play-logs` の本文:

```json
{
  "playId": "UUID",
  "seedCode": "NYORO:n1:easy:...",
  "generatorVersion": "n1",
  "difficulty": "easy",
  "outcome": "cleared",
  "startedAt": 0,
  "endedAt": 0,
  "elapsedMs": 0,
  "hintsUsed": 0,
  "maxHintStage": 0,
  "maxAssist": 2,
  "reveals": 0,
  "appVersion": "0.0.0+a44dd3f",
  "truncated": false,
  "events": [["start", 0], ["move", 1200, "tap", [[3, 0, 1]]], ["end", 95000, "cleared"]]
}
```

各イベントは `[種類, 計時の経過ミリ秒, ...]` の配列です。

| 種類 | 続く値 | 内容 |
| --- | --- | --- |
| `start` | — | READY の OK |
| `pause` | — | 一時停止（READY に戻る） |
| `move` | 出どころ、変わった辺 | 盤面の変化はすべてこれで記録する。出どころは `tap`・`stroke`（なぞりの最初）・`stroke-more`（同じなぞりの続き）・`hint`（ヒントの書き込み）・`undo`・`redo`・`reset`。変わった辺は `[辺, 前の状態, 後の状態]` の配列で、変わった辺を先頭から順に当てると盤面を再現できる |
| `hint` | 段階、内容 | 段階は `1`〜`3`。内容は定石の ID、`MISTAKE`、`REVEAL` |
| `assist` | 段階 | アシストの切り替え（`0`〜`2`） |
| `tool` | 書き込むもの | `line` か `cross` |
| `zoom` | — | 長押しの拡大 |
| `end` | 結果 | `cleared` か `abandoned`。最後のイベント |

- イベントは 3,000 件まで。超えた分は記録せず `truncated` を真にする（`end` だけは加える）
- `outcome` は `cleared`（クリア）か `abandoned`（盤面を変えたあと、解かずに次の問題へ移った）。盤面を一度も変えなかった試行は送らない
- サーバーは形式と値域、シードコードと版・難易度の一致を検証する。盤面は再生成しない（ランキングに使わないため。読む側が再生成して照合する）
- 同じ `playId` の再送は成功とし、上書きしない。新規の登録は ID ごとに 1 時間で 60 件まで。超えたら `429`
- 応答は `{ status }`（`created` か `duplicate`）
- イベントの種類は足すだけにし、既存の種類の意味を変えない。送られた古いログを読めるようにするため

### 感想

[`DESIGN.md`](./DESIGN.md) 20.2 の感想です。形式の正本は `src/core/feedback.ts` です。

`POST /api/feedback` の本文:

```json
{
  "body": "感想の本文",
  "context": {
    "from": "clear",
    "playId": "UUID",
    "seedCode": "NYORO:n1:easy:...",
    "difficulty": "easy",
    "cleared": true,
    "elapsedSeconds": 120,
    "hintsUsed": 0,
    "maxAssist": 2,
    "appVersion": "0.0.0+a44dd3f"
  }
}
```

- `body` は前後の空白を除いて 1〜1,000 文字（コードポイント）
- `from` は `menu` か `clear`。盤面がないときは `playId`・`seedCode`・`difficulty`・`maxAssist` を `null` にする
- ID ごとに 1 時間で 5 件まで。超えたら `429 too_many`
- 応答は `{ status: "created" }`。サーバーから感想を読み返す API はない
- 端末は送った感想を `nyoro-rin.sent-feedback.v1` に `{ version: 1, sent: [{ sentAt, body }] }` として新しい順に 20 件残す

### 退会

退会は kan-game.app のアカウント画面で行い、ID 基盤が NYORO-RIN の `GameService.deleteAccount` を呼びます。NYORO-RIN はその ID を `deleted_accounts` に記録し、同じトランザクションで完了記録・プロフィール・ランキングの記録・投稿制限の情報・プレイログ・感想を削除します。退会後の ID の Cookie は `410 id_deleted` で断ります。端末のローカル履歴は削除しません。

kan/game 側で、NYORO-RIN の GameService を binding（`GAME_NYORO`）として登録する必要があります。

## D1

以下の表を作ります（`0001_initial.sql` と `0002_play_logs_feedback.sql`）。列の詳細はマイグレーションを正とします。

| 表                    | 内容                                                    |
| --------------------- | ------------------------------------------------------- |
| `completed_plays`     | 完了記録。主キーは `(account_id, play_id)`              |
| `profiles`            | プレイヤー名・同意の版・同意した時刻                    |
| `first_ranked_plays`  | 問題別ランキングの初回。主キーは `(account_id, puzzle_id)` |
| `deleted_accounts`    | 退会した ID                                             |
| `rate_limits`         | 投稿制限                                                |
| `play_logs`           | プレイログ。主キーは `(account_id, play_id)`。イベントの JSON と、受け取ったときに数えた手数・ヒントの段階数・最長の間隔など |
| `feedback`            | 感想と、送ったときの様子                                |

D1 のスキーマ変更はマイグレーションを足して行い、適用済みのマイグレーションを書き換えません。マイグレーションは新しい Worker より先に適用します。

## 回帰テストにする境界条件

1. 同じ版・大きさ・数字から同じ問題 ID を得る。シード・難易度・正解では変わらない
2. 版・大きさ・数字のいずれかが変わると、問題 ID が変わる
3. `n1` のシードコードは、版を足した後も同じ盤面に復元できる
4. 辺の番号付けが、保存・API・Core で一致する
5. 旧保存形式を読め、壊れた JSON・不正な値からもゲームを始められる
6. 同じ `playId` の再送は重複しない。違う内容は上書きしない
7. 正解と一致しない `loop` を拒否する
8. ID を持つ前のクリアは送信しない。名前の設定前のクリアは送信するが公開しない。別の ID の未送信記録は送信しない
9. 同時の送信でも初回は 1 件だけ選ばれ、初回より速い再挑戦で置き換わらない
10. 公開の応答にアカウント ID・`playId`・正解を含めない
11. 退会でその ID の記録だけが消え、以後の Cookie は断られる
12. ID がなくてもローカルでプレイ・保存・ヒントが使える
13. プレイログの `move` を順に当てると、元に戻す・やり直す・リセットを含めて、プレイヤーが見た盤面に戻る
14. プレイログと感想は、退会でその ID の分だけ消える。同じ `playId` のプレイログの再送は重複しない
