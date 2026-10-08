# 設計文書 — X Auto Playlist（仮称）

要件文書（`docs/requirements.md` 第 3 版）を基に PL が設計したもの。部下 4 名の調査（X 内部データ／Chrome 拡張の仕組み／ビルドツール／UI 参考）を反映済み。

- 作成日：2026-09-28
- 状態：**確定（第 1 版）。ホスト確認後に実装段階 0 へ進む**

---

## 1. 設計方針（PL の判断）

1. **X の内部データ（GraphQL 応答）の解釈を 1 モジュール（`collector`）に閉じ込める。** ここが最も壊れやすい（要件 T-01 / N-04）。壊れたら UI に「収集できません」と出す。
2. **UI はページ内 Shadow DOM に描画する。** サイドパネル（右側）と再生ウィンドウ（浮かぶ小窓）は同じ Shadow Root に置き、フルスクリーンは両方を包むコンテナごと全画面にする（要件 F-1C / F-4B / T-06）。調査で「Shadow DOM 内の要素にも全画面化は可能」と確認済み。実機確認は段階 1 で行う。
3. **状態は 1 か所（ストア）に集約し、UI はそれを映すだけ。**
4. **再生は `<video>` 2 本（現在／次）のダブルバッファ**で先読みを実現する（要件 F-44 / T-07）。
5. **Service Worker は最小限**（アイコンクリック、右クリックメニュー、バッジ、storage.session の開放）。ロジックはコンテンツスクリプト側。
6. **1 タブ動作**（要件 T-10）。
7. **収集では自前リクエストを送らない。** X が自分で取りに行った応答を「受け身で読む」だけにする（規約リスクを最小に。§11）。**唯一の例外は F-4C の投稿操作（いいね／ブックマーク／リポスト）**で、ユーザーがボタンを押したときだけ、その 1 件の書き込みを X の内部 API へ送る（§6.8。ホストがリスクを了承済み、2026-09-28）。

## 2. 技術スタック（確定）

| 項目 | 決定 | 版 | 理由 |
|---|---|---|---|
| 言語 | TypeScript | 最新 | |
| ビルド | **WXT** | 0.21.4 | MV3 対応、`createShadowRootUi` で Shadow DOM UI とスタイル隔離が標準で使える、`world: "MAIN"` スクリプトに対応、HMR・自動リロードあり。CRXJS 3.0 も可だが Shadow DOM ヘルパーが無い |
| UI | **Preact + @preact/signals** | 10.29 / 2.11 | 約 3KB と軽い。React は Shadow DOM 境界でイベント二重発火の既知バグがある。signals をそのままストアにする |
| 並べ替え | **自前（Pointer Events）** | — | dnd-kit は Shadow DOM 内での並べ替え不具合が未解決。並べ替えは優先度「低」（F-13）なので、単純な縦一列の並べ替えを自前で書く。困ったら SortableJS を検討 |
| HLS | **初期版では入れない** | （hls.js 1.7.3） | 直接再生できる mp4 が無い動画は「再生不可」表示（T-02）。Chrome 142（2026-10 予定）で m3u8 のネイティブ再生が入る見込みのため、後で判断 |
| 単体テスト | **Vitest** | 5.0.2 | `collector` を実際の応答 JSON の抜粋（fixture）でテストするのが最も価値が高い |
| 結合テスト | **実機（x.com にログインした Chrome）で手動** | — | x.com ログインの自動化はボット検知で不安定。Playwright は「模擬ページにパネルが出る」程度の確認に限定 |
| Lint / Format | **Biome** | 2.5 | 新規 PJ の標準。1 ツールで済む |
| Node.js | **22 LTS が必要** | — | **現状 v19 では WXT（Node ≥22）も Vite 8（Node ≥20.19）も動かない。** 実装開始前にホストが更新する（§12） |
| パッケージ管理 | npm | 9 系（Node 更新で 10 系に上がる） | pnpm は壊れているため使わない |

## 3. 全体構成

```
┌──────────────────────────── x.com のタブ ────────────────────────────┐
│  MAIN world (document_start)          ISOLATED world                   │
│  ┌──────────────────┐  postMessage   ┌──────────────────────────────┐  │
│  │ interceptor      │ ─────────────▶ │ content script               │  │
│  │ XHR/fetch を差替 │ (応答の複製と  │  ├ collector  … 応答→PlaylistItem │  │
│  │ 操作名で選別     │  status/headers)│  ├ post-cache … 投稿ID→解釈済み投稿│  │
│  └──────────────────┘                │  ├ store      … signals（唯一の状態）│  │
│                                      │  ├ player     … <video>×2 制御    │  │
│  x.com の DOM                        │  ├ scroller   … 自動スクロール     │  │
│  ┌──────────────────┐  contextmenu   │  ├ navigation … SPA 遷移検知       │  │
│  │ article (投稿)    │ ─────────────▶ │  ├ context-target … 右クリック対象 │  │
│  └──────────────────┘  target 記録    │  ├ hotkeys    … ショートカット     │  │
│                                      │  ├ ui (Shadow DOM, Preact)       │  │
│                                      │  │   ├ SidePanel                 │  │
│                                      │  │   └ PlayerWindow              │  │
│                                      │  └ bridge     … SW との通信       │  │
│                                      └──────────────┬───────────────┘  │
└─────────────────────────────────────────────────────┼──────────────────┘
                                                      │ runtime message
                                          ┌───────────▼───────────┐
                                          │ Service Worker         │
                                          │  ├ action.onClicked → TOGGLE_PANEL │
                                          │  ├ contextMenus（x.com のみ）      │
                                          │  ├ badge（tabId 指定）             │
                                          │  └ storage.session.setAccessLevel │
                                          └───────────────────────┘
```

## 4. モジュール分割と責務

| モジュール | world | 責務 | 備考 |
|---|---|---|---|
| `interceptor` | MAIN | `XMLHttpRequest.prototype.open/send` と `window.fetch` を差し替え、URL が `/i/api/graphql/<queryId>/<操作名>` で操作名が対象一覧に合致する応答だけを複製して `window.postMessage` で渡す。**JSON の中身は解釈しない。** status と `x-rate-limit-*` ヘッダも渡す | X は主に XHR を使う（調査）。fetch も保険で差し替える。`run_at: document_start` 必須。queryId は無視し操作名で照合 |
| `collector` | ISOLATED | 生の JSON から投稿・メディアを抜き出し `ParsedPost` / `PlaylistItem[]` に変換。**X の構造知識はここだけ** | 純粋関数。Vitest の主対象 |
| `post-cache` | ISOLATED | このページで見た投稿を `postId → ParsedPost` で保持（上限 2000 件、古いものから捨てる）。右クリック追加の情報源 | 自前リクエストを避けるため（方針 7） |
| `store` | ISOLATED | signals による状態の唯一の置き場。派生値（現在の一覧、次の項目）もここ | §5 |
| `player` | ISOLATED | `<video>` 2 本と `<img>` の制御。再生・停止・シーク・音量・速度・ループ・シャッフル・画質切替・PiP・エラー時スキップ・画像／GIF の表示時間 | §6.2 / §6.3 |
| `scroller` | ISOLATED | 再生中のみ、末尾に近づいたら少しずつスクロール。429 検知で待機 | §6.6 |
| `navigation` | ISOLATED | Navigation API で遷移検知（保険で `pushState` ラップ）。ページ種別判定。自動プレイリストの作り直し | §6.5 |
| `context-target` | ISOLATED | `contextmenu`（capture）で `event.target` を記録。SW からの通知で `closest('article[data-testid="tweet"]')` → `time` の親 `a[href*="/status/"]` から postId を得る | §6.4 |
| `hotkeys` | ISOLATED | キーボードショートカット。入力欄フォーカス時は無効 | §6.7 |
| `ui/SidePanel` | ISOLATED | 一覧、選択、ダブルクリック再生、削除、並べ替え、再生操作、設定、トースト、幅変更 | §7.1 |
| `ui/PlayerWindow` | ISOLATED | 映像、コントロールバー、シークバー、VLC 風音量、メディア情報、フルスクリーン、ドラッグ移動 | §7.2 |
| `bridge` | ISOLATED | SW とのメッセージ（開閉、右クリック追加、バッジ件数） | |
| `background` | SW | アイコンクリック → `TOGGLE_PANEL`、右クリックメニュー登録（`documentUrlPatterns: ["https://x.com/*"]`, `contexts: ["all"]`）、バッジ、起動時に `storage.session.setAccessLevel("TRUSTED_AND_UNTRUSTED_CONTEXTS")` | `default_popup` は設定しない |

## 5. データモデル

```ts
type MediaKind = "video" | "gif" | "photo";

interface MediaSource {
  url: string;
  mime: "video/mp4" | "application/x-mpegURL" | "image/jpeg" | "image/png" | "image/webp";
  bitrate?: number;          // mp4 のみ。画質の並び替え用
  width?: number; height?: number;
}

interface PlaylistItem {
  id: string;                // media_key（無ければ id_str）。重複除外の鍵
  kind: MediaKind;
  postId: string;
  postUrl: string;           // https://x.com/<screenName>/status/<postId>
  author: { name: string; screenName: string; avatarUrl: string };
  text: string;              // 全文（note_tweet があればそちら）
  thumbnailUrl: string;      // media_url_https
  durationMs?: number;
  sources: MediaSource[];    // 画質順（高→低）
  playable: boolean;         // mp4 または画像がある
  addedAt: number;
}

interface ParsedPost {       // post-cache に入れる単位
  postId: string;
  items: PlaylistItem[];     // 1 投稿の全メディア（最大 4）
}

interface PlaylistState {
  mode: "auto" | "manual";                            // S-01
  auto:   { pageKey: string; items: PlaylistItem[] };
  manual: { items: PlaylistItem[]; lastPlayedId: string | null };  // F-52
}

interface PlaybackState {
  status: "idle" | "playing" | "paused";
  currentId: string | null;
  selectedId: string | null;   // メモリのみ（F-18）
  loop: "all" | "one" | "off";
  shuffle: boolean;
  volume: number;              // 0〜1、5% 刻み
  muted: boolean;
  speed: number;               // 0.5〜2
  quality: "auto" | "highest" | "lowest";  // 一時変更（既定は S-10）
  playedIds: string[];
  consecutiveErrors: number;   // 3 回連続で停止
}

interface Settings { /* S-01〜S-18。既定値は要件 §5 */ }
```

**保持先**

| 状態 | 置き場 | 理由 |
|---|---|---|
| `Settings`、パネル幅、再生ウィンドウの位置と大きさ | `chrome.storage.local` | 永続 |
| `PlaylistState.manual`（`lastPlayedId` 含む） | `chrome.storage.session` | セッション中はどの場合でも保持（F-52）。ブラウザ終了で消える。SW 側で access level を開放しておく |
| `PlaylistState.auto`、`selectedId`、`PlaybackState` | メモリのみ | ページ移動で作り直す／記憶しない |

## 6. 主要な流れ

### 6.1 収集（自動プレイリスト）

1. `interceptor` が対象操作名の応答を渡す。対象と応答内の位置：

   | ページ | 操作名 | instructions の位置 |
   |---|---|---|
   | ホーム | `HomeTimeline` / `HomeLatestTimeline` | `data.home.home_timeline_urt.instructions` |
   | ブックマーク | `Bookmarks` | `data.bookmark_timeline_v2.timeline.instructions` |
   | いいね | `Likes` | `data.user.result.timeline.timeline.instructions` |
   | ユーザーのメディア | `UserVideoTimeline` / `UserPhotoTimeline`（`UserMedia` は 2026-08 に廃止） | 同上系統 |
   | 検索 | `SearchTimeline` | `data.search_by_raw_query.search_timeline.timeline.instructions` |
   | 投稿詳細 | `TweetDetail` | 右クリック追加の補助用 |

   位置は固定せず、`instructions` を再帰的に探して `TimelineAddEntries` と `TimelineAddToModule` の両方を拾う（構造変更に強くする）。
2. `collector` が各エントリの `tweet_results.result` を解釈する。
   - `__typename` が `TweetWithVisibilityResults` なら `.tweet` を使う。`TweetTombstone` / `TweetUnavailable` は無視。
   - リポストは `legacy.retweeted_status_result.result` 側を、引用は本体と `quoted_status_result.result` の**両方**を対象にする（引用元のメディアも画面に表示されるため）。
   - 投稿者：`core.screen_name` / `core.name` / `avatar.image_url` を優先し、無ければ旧 `legacy.*` にフォールバック（2026-07 に構造変更あり）。
   - 本文：`note_tweet.note_tweet_results.result.text` があればそれ、無ければ `legacy.full_text`。
   - メディア：`legacy.extended_entities.media[]`。`photo` → 画像 URL、`video` / `animated_gif` → `video_info.variants` の `video/mp4` を bitrate 降順で `sources` に。m3u8 も `sources` に残す（将来用）。`playable = mp4 か画像がある`。
   - すべての投稿を `post-cache` に入れる（ページ種別に関係なく）。
3. 自動モードかつ現在の `pageKey` に対応する応答なら、`auto.items` の末尾に**追記**。`id` で重複除外（S-16）。画像は S-03 が OFF なら除外。
4. UI が一覧を更新。**再生は始めない**（F-01 / F-16）。バッジを更新。

### 6.2 再生開始と進行

- 再生ボタン：`selectedId` があればそこから。無ければ、マニュアルモードで `lastPlayedId` が一覧に残っていればそこから（F-52）。それも無ければ先頭（F-17）。
- ダブルクリック：その項目から（F-24）。
- 次の決定：ループ `one` → 同じ項目。`shuffle` → 未再生から乱択。`all` → 末尾なら先頭へ。`off` → 末尾で停止。
- 自動モードで次が無い場合：`scroller` に読み込みを要求し、追加されるまで「読み込み中」表示で待つ（最大 30 秒で停止）。
- 画像：`<img>` を表示し S-04 秒後に次へ。GIF：`<video loop muted>` で再生し S-04 秒後に次へ（F-06）。
- 動画のエラー：トースト → 次へ（F-49）。3 回連続で停止。
- 再生中は `lastPlayedId` を更新（マニュアルのみ）。`playedIds` に追加。
- 再生中は X 側の `<video>` を `pause()` する（S-15。MutationObserver は使わず、x.com 側の `video` に `play` イベントリスナーを capture で付けて止める）。

### 6.3 先読み（ダブルバッファ）

- `<video>` を A/B の 2 本持つ。A が再生を始めたら、B に「次の項目」の **再生に使う画質と同じソース**を `preload="auto"` で読み込ませる。Chrome は preload を冒頭 20〜30 秒程度で頭打ちにするため、「冒頭だけ」は自然に満たされる。
- **PL 判断（要件からの調整）：** 要件 F-44 は「最低画質で冒頭だけ」としていたが、最低画質で先読みしてから再生画質に切り替えると読み直しが発生し、待ち時間削減の目的に反する。**先読みは再生画質と同じソース**で行う。通信量は S-12 で OFF にできる。ホストに報告する。
- 切り替え時は B を前面に出し、A を予備に回す。S-12 が「前後 1 件」のときは、前の項目は `preload="metadata"` に留める。
- 同時に存在する `<video>` は「再生用 2 本＋ホバー用 1 本」の最大 3 本に制限（Chrome はフレームあたり 75 本で生成をブロックする）。

### 6.4 右クリック追加

1. `context-target` が `contextmenu`（capture）で `event.target` を記録。
2. SW の `contextMenus.onClicked`（`contexts: ["all"]`、x.com のみ）→ `bridge` へ `ADD_FROM_CONTEXT { position: "end" | "next" }`。
3. `context-target` が記録要素から `article[data-testid="tweet"]` を辿り、`time` の親 `a[href*="/status/"]` から postId を得る（引用投稿の内側リンクを誤って拾わないため `time` を優先）。
4. `post-cache` から `ParsedPost` を引き、`manual.items` に全メディアを追加（末尾または現在の次）。
5. 見つからない場合（拡張機能の読み込み前に表示された投稿など）：トースト「この投稿の情報を取得できませんでした。ページを再読み込みしてください」。**自前でリクエストは送らない。**
6. トースト表示、バッジ更新。

### 6.5 SPA 遷移

- Navigation API の `navigate` イベントで検知（保険で `pushState` / `replaceState` ラップと `popstate`）。
- URL からページ種別を判定：`/home`、**`/i/history`（ブックマーク。旧 `/i/bookmarks` はここへ転送される）**、**`/i/history/likes`（いいね。旧 `/<user>/likes` も残す）**、`/<user>/media`、`/search`、`/<user>/status/<id>`、その他。（2026-09-28 に実機で確認。X は「履歴」画面にブックマークといいねをタブとしてまとめた。通信名は従来どおり `Bookmarks` / `Likes`）
- 種別または URL が変わったら `auto` を空にし `pageKey` を更新。**再生中の項目は続けて再生**し、自動モードでは終了後に停止する（次の項目が無くなるため）。マニュアルは影響なし。
- `post-cache` は遷移しても保持する（同じタブ内なら投稿情報は使い回せる）。

### 6.6 自動スクロール（再生中のみ）

- 条件：自動モード・再生中・残り項目が 3 件以下。
- 動作：`window.scrollBy` で画面 1 枚分ずつ、**最短 5 秒間隔**。応答が来たら一旦止める。
- 制限検知：`interceptor` が渡す status が 429、または `x-rate-limit-remaining` が 5 未満なら、`x-rate-limit-reset` まで（不明なら 60 秒）待つ。UI に「X の読み込み制限のため待機中」と出す。
- S-13 の「速さ」は間隔（ゆっくり＝10 秒、普通＝5 秒）。

### 6.7 キーボードショートカット

- `document` に capture で `keydown` を付ける。`activeElement`（Shadow 内は `composedPath()` の先頭）が `input` / `textarea` / `select` / `[contenteditable]` なら**何もしない**（`stopPropagation` もしない）。
- パネルが開いていて再生ウィンドウが表示中のときだけ有効。処理したキーだけ `stopPropagation` する（x.com の j/k などは影響しない）。
- 割り当て：Space 再生／停止、← → 前後、↑ ↓ 音量 ±5%、F フルスクリーン、M ミュート、L ループ切替、P PiP。

### 6.8 投稿操作（いいね／ブックマーク／リポスト、F-4C）

- モジュール `post-actions`（ISOLATED world）。ユーザーが再生ウィンドウのボタンを押したときだけ、X の内部 GraphQL の書き込み操作を **1 件** 送る：`FavoriteTweet` / `UnfavoriteTweet`、`CreateBookmark` / `DeleteBookmark`、`CreateRetweet` / `DeleteRetweet`。
- 送信は content script の `fetch`（x.com と同一オリジンなので Cookie が自動で付く）。ヘッダは X の Web クライアントと同じ：`authorization: Bearer <Web クライアント共通の公開トークン>`、`x-csrf-token: <Cookie ct0>`、`x-twitter-auth-type: OAuth2Session`、`x-twitter-active-user: yes`、`content-type: application/json`。本文は `{ variables: { tweet_id }, queryId }`。
- **queryId の取得**（2〜4 週間で変わる）：2 系統で学習し `chrome.storage.session` に保持する。
  1. X のクライアント JS（`https://abs.twimg.com/responsive-web/client-web/*.js`。ページの HTML から URL を得る）を取得し、`queryId:"…",operationName:"FavoriteTweet"` の形を正規表現で拾う。
  2. 保険として、`interceptor` が上記 6 操作の**リクエスト URL** を観測したら queryId を覚える（ユーザーが X 上で普通にいいねしたときに学習できる）。
- 現在の状態（いいね済み等）は `collector` が投稿の `legacy.favorited` / `bookmarked` / `retweeted` を `PlaylistItem.post` に入れて持つ。操作成功で反転し、同じ投稿の全項目に反映する。
- 失敗（401/403/429/queryId 不明）はトーストで知らせ、状態は変えない。
- 設定 S-20 で OFF にでき、OFF ならボタン自体を出さない。
- **実機結果（2026-09-28）**：いいね・リポストは成功。**ブックマーク（CreateBookmark）は queryId・本文が X 本体と同一でも 404**。X が一部操作に要求する署名ヘッダ `x-client-transaction-id`（X のコードがリクエストごとに生成）が無いためと判断。署名の再現は行わず、X 本来のボタンを自動で押す回避も採用しない（実行環境の安全判定で拒否）。よって**ブックマークのボタンは出さない**。いいね・リポストも将来同じ要求が始まれば動かなくなる可能性がある（§11）。

## 7. UI 設計

実装時に **frontend-design Skill**（導入済み）を適用し、配色・タイポグラフィを PJ 固有に決める。ここでは構造だけ定める。

### 7.1 サイドパネル

```
┌──────────────────────────────┐
│ ▶ X Auto Playlist  [自動|手動] ⚙ ✕ │  ヘッダー：モード切替、設定、閉じる
├──────────────────────────────┤
│ ⏮ ⏯ ⏭   🔁 🔀   🔊━━━━   3/27 │  再生操作（常に見える）
├──────────────────────────────┤
│ ┌────┐ @user  本文の冒頭10文… ⋮ │  一覧：サムネ／投稿者／本文冒頭／メニュー
│ └────┘                        │   ・シングルクリック＝選択（枠）
│ ┌────┐ @user  本文の冒頭10文… ⋮ │   ・ダブルクリック＝再生
│ └────┘ ← 再生中（塗り＋アイコン）│   ・ホバーでサムネが動く（5 秒）
│ …                            │   ・ドラッグで並べ替え（手動時のみ）
├──────────────────────────────┤
│ 🗑 空にする      再生済み: 薄く ▾ │  フッター
└──────────────────────────────┘
```

- 配置：**分割ビュー（push）**。ホスト指示（2026-09-28）により覆いかぶせ（overlay）から変更。パネルは `position: fixed; right: 0; top: 0; height: 100vh` のまま、**x.com の文書側を `html { width: calc(100% - パネル幅) }` 相当で左に押し縮める**（`layout` モジュールが `document.documentElement` のインラインスタイルで幅を与え、パネルを閉じたら戻す）。x.com は中央寄せの可変レイアウトなので、幅が縮むと自動で再配置される（狭いときは X 自身の狭幅レイアウトになる）。X の `position: fixed` な要素（メディアビューアなど）はビューポート基準のためパネルの下に伸びるが、パネルの z-index が上なので問題ない。境目のドラッグで分割位置を変える（F-19）。
- 幅：既定 360px、ドラッグで 300〜560px。記憶する。
- 一覧の行：サムネイル 96×54（16:9）、右に投稿者（太字）と本文冒頭 10 文字、右端に ⋮（削除／次に再生／元ポストへ）。ホバーで ⋮ を表示（Video DownloadHelper 流）。
- 選択中と再生中の区別：選択＝枠線、再生中＝背景の塗り＋再生アイコン（F-22）。
- ホバー再生：ホバー時にだけ `<video muted preload="metadata">` を 1 本生成し、最低画質 mp4 を 5 秒再生。離れたら破棄。同時 1 本。
- テーマ：`:host` の CSS 変数。ライト／ダーク／システム（`prefers-color-scheme`）。フォントはシステムフォント（Shadow DOM 内の `@font-face` は効かないため）。
- 「収集できません」バナー：`collector` が一定回数連続で解釈に失敗したら一覧の上に表示（N-04）。

### 7.2 再生ウィンドウ

```
┌──────────────────────────────────────┐
│ (ドラッグ可能なタイトルバー)   PiP ⤢ ✕ │
│                                      │
│              映像                    │
│                                      │
│ ┌ ⓐ @user  本文の縮小版（2 行）… [▾] ┐ │  メディア情報（F-41/42）。▾ で全文をスクロール表示
│ ━━━━━━━━●━━━━━━━━━━━━━━━━━━━━ 0:12/1:30 │  シークバー（ホバーで時刻表示）
│ ⏮ ⏯ ⏭  🔊━━━ 50%  1.0x  自動 ▾  ⛶      │  コントロール：音量、速度、画質、全画面
└──────────────────────────────────────┘
```

- 配置：ページ上に浮かぶ小窓。既定は右下（パネルの左隣）、幅 480px、16:9。タイトルバーでドラッグ移動、右下でリサイズ。位置と大きさは記憶。
- 音量：ホバー中のホイールで ±5%、バーのクリックでその位置へ、数値を表示。0〜100%（VLC の 125% は採用しない）。
- コントロール自動非表示：操作が 3 秒無いと隠す（フルスクリーン時のみ）。
- フルスクリーン：パネル＋ウィンドウを包むコンテナに `requestFullscreen()`。ウィンドウはパネル以外の領域いっぱいに広がる。ユーザー操作のハンドラ内から呼ぶ。
- 代替（F-4B）：段階 1 の試作で小窓が成立しない場合、再生開始時にページ領域いっぱい（パネル除く）に表示する形へ切り替える。
- PiP：標準の `video.requestPictureInPicture()`。Document PiP は使わない。
- 画質切替：`sources` の bitrate から「最高／最低／自動（表示サイズに近い解像度）」。切替時は `currentTime` を引き継いで読み直す。

## 8. ソース構成（WXT の規約に従う）

```
wxt.config.ts
package.json
biome.json
src/
  entrypoints/
    background.ts              Service Worker
    x-main.content.ts          MAIN world（interceptor だけを配線）
    x.content.ts               ISOLATED world（下記モジュールを配線する唯一の場所）
  lib/
    interceptor/               MAIN world 用（依存なし）
    collector/                 X 応答の解釈（純粋関数）＋ fixtures/
    post-cache/
    store/
    player/
    scroller/
    navigation/
    context-target/
    hotkeys/
    bridge/
  ui/
    panel/
    player-window/
    settings/
    theme/                     CSS 変数、テーマ
  shared/
    types.ts                   PlaylistItem など
    messages.ts                SW ↔ content のメッセージ定義
    constants.ts               操作名一覧、既定値
tests/                         Vitest（collector を中心に）
docs/
```

## 9. 共有ファイル（single writer：PL のみ編集）

- `package.json` / `package-lock.json`
- `wxt.config.ts` / `biome.json` / `tsconfig.json`
- `src/entrypoints/*`（配線ファイル）
- `src/shared/*`（型・メッセージ・定数）
- `src/ui/theme/*`

依存パッケージの追加は PL が段階 0 でまとめて行う。

## 10. 実装の段階分け（PDCA の単位）

| 段階 | 内容 | 合格条件 | 想定モデル |
|---|---|---|---|
| 0 | 足場：WXT 初期化、manifest、Biome、Vitest、空のパネルが x.com に出る、アイコンクリックで開閉、バッジ | ビルド通過、パネル開閉が動く | PL（共有ファイル）＋ Sonnet |
| 1 | **試作（T-06 の確認）**：Shadow DOM 内で `<video src=mp4>` 再生、コンテナ全画面化にパネルが含まれるか、浮かぶ小窓のドラッグ、PiP | 実機で 4 点を確認。不可なら F-4B の代替へ | Opus |
| 2 | 収集：interceptor + collector + post-cache。ホーム／ブックマーク／いいね で一覧が出る。collector の単体テスト | 一覧に項目が並ぶ。件数がバッジに出る。テスト通過 | Opus |
| 3 | 再生：再生ボタン／ダブルクリック、次／前、ループ、シャッフル、音量（VLC 風）、シークバー、画像／GIF の表示時間、メディア情報、フルスクリーン | 要件 §4.4 の必須が通る | Opus |
| 4 | 自動スクロールと制限待機、SPA 遷移の作り直し、右クリック追加、マニュアル保持と再開位置 | 要件 §4.1 の必須が通る | Opus |
| 5 | 先読み、画質切替、速度、PiP、ショートカット、エラースキップ、X 側自動再生の停止 | | Sonnet / Opus |
| 6 | 設定画面、テーマ、幅変更、再生済みの扱い、トースト、ホバー再生、並べ替え、元ポストへ | | Sonnet |
| 7 | 仕上げ：frontend-design Skill でデザインの見直し、結合テスト、監査 | 要件 §4 の必須すべて＋監査 3 点 | Opus |

各段階の終わりに PL が監査（agent_rule §4）を行う。

## 11. リスクと対策

| リスク | 対策 |
|---|---|
| X の内部構造変更（操作名、JSON の形、投稿者欄の移動など。2026 年だけで 3 回の大きな変更） | `collector` に閉じ込める。fixture を残し、壊れたら fixture を更新して直す。UI に「収集できません」を出す |
| queryId の変更（2〜4 週間ごと） | queryId を見ない。操作名だけで照合 |
| 読み込み制限（429） | 自動スクロールは再生中のみ・最短 5 秒間隔。制限検知で待機 |
| 規約（スクレイピング禁止条項） | 自前リクエストを送らず、X が取得した応答を受け身で読むだけにする。個人利用に限る。自動スクロールは控えめにする。凍結リスクはゼロではないことをホストが了承済み |
| フルスクリーンにパネルを含められない | 段階 1 で確認。不可なら F-4B の代替 |
| 投稿操作（F-4C）は X への書き込み。自動操作とみなされアカウントに制限がかかる可能性、queryId の変更で壊れる可能性 | ユーザーの明示操作 1 回につき 1 件だけ送る。queryId は 2 系統で学習。失敗は静かに知らせる。設定で OFF にできる。ホストがリスクを了承済み |
| mp4 の無い動画 | 再生不可表示でスキップ。Chrome 142 以降のネイティブ HLS を待つ |
| Shadow DOM 内での並べ替えライブラリの不具合 | 自前実装（優先度「低」） |

## 12. ホスト側で必要な準備

1. **Node.js を 22 LTS に更新する。** 現状の v19 では WXT / Vite が動かない。方法は公式インストーラ、または `winget install Schniz.fnm` で fnm を入れて `fnm install 22`。
2. Chrome で `chrome://extensions` → デベロッパーモード ON（ビルド成果物 `.output/chrome-mv3` を「パッケージ化されていない拡張機能を読み込む」で読み込む）。
3. x.com にログイン済みであること。

## 13. 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-09-28 | 下書き作成 |
| 2026-09-28 | 第 1 版。調査 4 件を反映し技術スタックと未決事項を確定。先読み画質の調整（§6.3）を PL 判断として記録 |
| 2026-09-28 | 実装完了後の更新。分割ビュー（§7.1）、X の「履歴」画面（§6.5）、投稿操作（§6.8）とその実機結果、リスク追記。段階 8（解像度選択、投稿操作、パネル切替とアイコン刷新）を追加実施。最終確認は `docs/final_check.md` |
