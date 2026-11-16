# NYORO-RIN — デプロイ

NYORO-RIN を kan-game.app で配信する手順です。環境の構成は [`DESIGN.md`](./DESIGN.md) 第 21 章を正とします。手順は TAKO-SEN（`docs/DEPLOY_PROD.md`）と pujan（`docs/DEPLOY.md`）に倣います。

**デプロイ、リモートの D1 への操作（作成、マイグレーション、SELECT 以外のクエリ）は、利用者の承認を得てから行います。** GitHub Actions からはデプロイしません。手元で実行します。

| 環境 | URL | Worker | D1 | ID 基盤 |
| --- | --- | --- | --- | --- |
| 本番 | `https://nyoro.kan-game.app` | `nyoro` | `nyoro-prod` | `kan-game` |
| 開発 | `https://nyoro-dev.kan-game.app` | `nyoro-dev` | `nyoro-dev` | `kan-game-dev` |

1 つの Worker が API（`/api/*`）と画面（`dist` の Static Assets）の両方を配ります。

## 前提

- `kan-game.app` のゾーンが同じ Cloudflare アカウントにあること。`wrangler.jsonc` の `routes`（`custom_domain: true`）だけで、サブドメインの DNS と証明書ができます
- `npx wrangler login` 済みであること（`npx wrangler whoami` で確かめる）
- Workers の有料プラン。`POST /api/plays` はシードから盤面を再生成して検証するので、無料プランの CPU 時間（10ms）に収まりません
- kan/game の ID 基盤が同じ環境に出ていること（`kan-game-dev`、`kan-game`）

## 初回（環境ごと。開発 → 本番の順）

`<env>` は `dev` か `production`、`<db>` は `nyoro-dev` か `nyoro-prod` です。

1. D1 を作る

   ```sh
   npx wrangler d1 create <db>
   ```

   出力の `database_id` を `wrangler.jsonc` の `env.<env>.d1_databases` の `database_id` に書き、`npm run cf-typegen` を実行してコミットする。

2. デイリーのシードの鍵（`DAILY_SEED_SECRET`）を置く。環境ごとに別の、推測できない値にし、どこにも書き残さない（変えると、まだ作っていない日の盤面が変わる。作った日の盤面は D1 に固定されているので変わらない）

   ```sh
   openssl rand -hex 32 | npx wrangler secret put DAILY_SEED_SECRET --env <env>
   ```

   `wrangler.jsonc` の `secrets.required` に入っているので、置かないとデプロイが止まります。

3. NYORO-RIN を出す（ビルド → マイグレーション → デプロイを順に行う）

   ```sh
   npm run deploy:<env>
   ```

4. kan/game に NYORO-RIN を登録して出し直す。**順番を守る: NYORO-RIN の Worker が `GameService` 付きで出てから。** 逆にすると、kan/game のデプロイが binding 先の不在で失敗するか、退会が毎回 `503 deletion_incomplete` になります。kan/game の `wrangler.jsonc` の `env.<env>` に次を足し、`npm run cf-typegen` のあと kan/game の `npm run deploy:<env>` を実行する。

   - `ALLOWED_ORIGINS` に `https://nyoro-dev.kan-game.app`（本番は `https://nyoro.kan-game.app`）
   - `services` に `{ "binding": "GAME_NYORO", "service": "nyoro-dev", "entrypoint": "GameService" }`（本番は `"service": "nyoro"`）
   - `GAMES` に `GAME_NYORO`

5. 確かめる（下の「公開後の確認」）

### 本番だけで行うこと

ポータル（kan/game）の一覧に載せます。kan/game の `AGENTS.md` の決まりに従います。

- `public/index.html` の `<ul class="games">` に NYORO-RIN の `<li>` を足す。属性は `data-game="nyoro-rin"` と `href="https://nyoro.kan-game.app/"`、アイコンは `/assets/games/nyoro-rin.svg`
- `public/assets/lib.js` の `GAME_HOSTS` に `"nyoro-rin": ["nyoro", "nyoro-dev"]` を足し、`test/portal-lib.test.ts` に例を足す
- `public/assets/games/nyoro-rin.svg` に、このリポジトリの `public/nyoro.svg` を写す
- `public/privacy.html` の「ゲームごとの記録」と「公開される情報」に NYORO-RIN の分を足し、改定日を書く（文面は利用者の承認を得てから）

## 2 回目以降

```sh
npm run deploy:<env>
```

マイグレーションを足したときも同じコマンドです（新しい Worker より先に適用されます）。

### デイリーを入れるとき（kan/nyoro-rin#7、既存の環境）

既に出ている環境では、デイリーの版を出す前に、環境ごとに次を行います。

1. `DAILY_SEED_SECRET` を置く（上の「初回」の 2）。置く前に Worker を出すとデプロイが止まります
2. `npm run deploy:<env>` で `0006_daily.sql` を当てて出す。`0003`〜`0005` が未適用なら一緒に当たります
3. 定期実行に `0 14 * * *`（日本時間 23:00、翌日の盤面を作る）が加わったことを、Cloudflare のダッシュボードの Triggers で確かめる

## 公開後の確認

1. `https://nyoro-dev.kan-game.app` を開き、READY から問題を解ける
2. 開発者ツールで `POST /api/id/session` が `200` を返し、`__Secure-kgdev_id`（本番は `__Secure-kg_id`）の Cookie が付く
3. クリアすると `POST /api/plays` が `201` を返し、クリアのカードにランキングが出る
4. メニューの「アカウント」で名前を決めると、次に解いた問題のランキングに載る
5. メニューの「感想を送る」から送れ、`npm run stats -- feedback --env dev` に出る
6. 次の問題へ移ると `POST /api/play-logs` が `201` を返し、`npm run stats -- summary --env dev` に出る
7. ポータル（`https://dev.kan-game.app/account`）でテスト用の ID を退会すると、その ID の `completed_plays`・`profiles`・`play_logs`・`feedback`・`daily_attempts` が消える
8. 名前を決めた 2 つの ID で、盤面の下のカレンダーのボタンからデイリーを開くと同じ盤面が出る。OK で `POST /api/daily/start` が `201` を返し、もう一方の端末や再読み込みでは同じ ID で始め直せない。クリアすると `POST /api/daily/complete` が `201` を返し、2 人がその日のランキングに載る。もう一度ボタンを押すとランキングが開く

確認の 5〜7 はリモートの D1 を読むので、利用者の承認を得てから行います。

## プレイログと感想を読む

```sh
npm run stats -- summary --env production --days 30
```

使い方と読み方は `AGENTS.md`「プレイログと感想」と `.claude/skills/playlog-review/SKILL.md` にあります。
