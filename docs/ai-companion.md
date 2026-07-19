# AIコンパニオン(VRMキャラとの会話・発話)実装契約

自分の VRM キャラクターと会話し、返答を音声(TTS)+リップシンクで喋らせる機能。
LLM/TTS は mistai(shared LLM Network)の provider に mist ルーム経由で依頼する。
provider 側(tc-mistllm 等が上流 API を代理する)は本アプリのスコープ外。

この文書は並列実装エージェント間の**拘束契約**。公開シグネチャ・キー名・トピック名は
ここに書かれたとおりに実装すること。変更が必要ならオーケストレーターに戻す。

## 決定済みアーキテクチャ(背景)

- **mistai は vendor コピー**(`src/vendor/mistai/`、コミット f3daf0c、済み)。
  npm 依存にはしない(ファミリーの vendor-copy 原則、CI 安全性)。
  consumer 側サブセットのみ: `protocol / consumer / voice-consumer / base64 / errors / messages / id`。
  `ConsumerClient` / `Network` は **vendor していない** — それらは自前の MistNode を
  new するため、tc-travel の「1ページ1ノード」モデルと衝突する。
- **既存ノードに相乗りする**。mistlib は SPEC-15 でマルチルーム同時参加をサポート:
  - `joinRoom(roomId)` は2つ目のルームで独立セッションを構築。参加済みなら再アナウンスのみ。
  - `sendMessage(toId, data, delivery, roomId)` — 第4引数でルームスコープ送信
    (`mist_send_message_in_room`)。**unscoped broadcast は全ルームに飛ぶ**ので、
    collab の Yjs 同期が AI ルームに漏れないよう collab 側もスコープ化する。
  - `leaveRoom(roomId)` はそのルームのみ終了。**no-arg `leaveRoom()` は全セッションを
    終了**(ノード decommission)なので collab の leave をスコープ化する。
  - イベントコールバックは第4引数 `roomId` を受け取る(v2 コールバック対応ビルド)。
- **onEvent は単一スロット**(wrapper の `_onEvent` を上書き)なので、mistNode.ts に
  ファンアウト・ディスパッチャを追加し、collab と AI クライアントの両方がそこに登録する。

## ファイル所有権(エージェント間で編集が重複しないこと)

| エージェント | 所有ファイル |
|---|---|
| A (core-net) | `src/lib/mistNode.ts`, `src/lib/collab.ts`, `src/lib/__tests__/mistDispatch.test.ts`(新規) |
| B (ai-lib) | `src/lib/ai/`(全て新規: `aiSettings.ts`, `companionClient.ts`, `speech.ts`, `lipSync.ts`)+ `src/lib/__tests__/ai*.test.ts` |
| C (ui) | `src/components/ar/companion.ts`, `vrmLoader.ts`, `ARCameraScreen.tsx`, `CompanionTalkPanel.tsx`(新規), `ar.css`, `ar.i18n.ts`, `src/components/guild/SettingsSection.tsx` と guild の i18n |

`src/vendor/mistai/` は完成済み・全員 import のみ(編集禁止)。

## A: mistNode.ts — イベント・ディスパッチャ

追加(既存 API は不変):

```ts
export type NodeEventHandler = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId?: string,
) => void;

/** 登録解除関数を返す。ノード未作成でも登録可(作成時に配線される)。 */
export function addNodeEventHandler(handler: NodeEventHandler): () => void;
```

実装要件:
- モジュールレベル `Set<NodeEventHandler>`。`new MistNode(...)` 直後に一度だけ
  `node.onEvent((...args) => { for (const h of handlers) try { h(...args) } catch (e) { console.warn("tc-travel: node event handler failed", e) } })`
  を設定(ハンドラ例外の隔離必須)。`_onEvent` はインスタンス状態なので re-init を跨いで生きる。
- ノード再作成(現状 node は一度作ったら使い回し)にも耐えるよう、onEvent 配線は
  ensureMistNode 内のノード生成箇所で行う。

## A: collab.ts — ルームスコープ化

1. `node.onEvent(...)`(現在 line ~309)を `addNodeEventHandler(...)` に置換。
   返された unsubscribe を保持し `leave()` で呼ぶ。
2. ハンドラ先頭でルームフィルタ:
   `if (roomId !== undefined && roomId !== this.roomId) return;`
   (roomId 未添付イベントは従来どおり処理 — 後方互換)。
3. 全 `sendMessage(...)` 呼び出しに第4引数 `this.roomId` を追加(broadcast/unicast とも)。
4. `leave()` の `this.node.leaveRoom()` → `this.node.leaveRoom(this.roomId)`(スコープ化)。
   これによりノードは initialized のまま残る(ensureMistNode は両方に耐える設計済み)。
   関連コメントを実態に合わせて更新すること。
5. テスト注入用 `MistNodeAccess` インターフェースのシグネチャも roomId 引数に追随。
6. 新規テスト `mistDispatch.test.ts`: ディスパッチャのファンアウト/解除/例外隔離、
   collab のルームフィルタ(fake node で別 roomId イベントが無視されること)、
   送信が roomId 付きで呼ばれること。

## B: src/lib/ai/aiSettings.ts

```ts
export type AiTaskRole = "orchestrator" | "worker"; // 内部識別子のみ。UIには出さない
export type AiTaskModelSetting = { presetId: string }; // "" = 未設定(既定presetへフォールバック)

export interface AiCompanionSettings {
  /** provider が announce している mist ルーム id。空文字 = 機能未設定 */
  roomId: string;
  model?: string;    // LLM モデル名(レガシー自由記入。空/undefined = 未設定)
  voice?: string;    // TTS ボイス名(同上)
  persona?: string;  // システムプロンプトに足すキャラ設定自由文
  ttsEnabled: boolean; // 既定 true
  tasks: Record<AiTaskRole, AiTaskModelSetting>; // resolveTaskModel 参照
}
export const AI_SETTINGS_KEY = "tc-travel:aiCompanion";
export function loadAiSettings(): AiCompanionSettings;   // 破損/不在 → 既定値
export function saveAiSettings(settings: AiCompanionSettings): void; // 失敗は console.warn で握る
export function isAiConfigured(settings?: AiCompanionSettings): boolean; // roomId.trim() !== ""
export function resolveTaskModel(role: AiTaskRole, settings?: AiCompanionSettings): string;
```

localStorage アクセスはモジュールロード時に行わない(vitest node 環境)。

`resolveTaskModel` は tc-docs/drafts/llm-settings-common-v1.md 準拠で、特定ベンダーの
モデル名をハードコードしたフォールバックを持たない(§5.3 チェックリスト項目8)。優先順位は
「タスクの presetId(共有 `tc-shared-llm-config-v1` を `resolvePreset` で解決)」→
「レガシー `settings.model`」→「共有設定自身の `defaultPresetId`」→ 空文字列(`model` フィールド
省略 = provider 側の既定モデルで応答、mistllm-wire の「model指定なし」規約どおり)。

## B: src/lib/ai/companionClient.ts

vendored mistai の `ConsumerService` + `VoiceConsumerService` を tc-travel の共有ノードに
配線し、provider 発見(mistai `client.ts` の createSession 相当ロジック)を担うシングルトン。

```ts
import type { ChatMessage } from "../../vendor/mistai";

export type CompanionPhase = "idle" | "joining" | "searching" | "connected" | "error";
export interface CompanionStatus {
  phase: CompanionPhase;
  providerId?: string;  // connected 時
  models?: string[];    // provider_hello.models
  message?: string;     // error 時(英語生文。表示側で i18n コードマップ優先)
  code?: string;        // MistaiErrorCode("PROVIDER_NOT_FOUND" | "JOIN_FAILED" 等)
}
export class CompanionClient {
  /** eager・throw しない。同一ルームに接続中/済みなら no-op。別ルームなら張り替え。 */
  connect(roomId: string): void;
  disconnect(): void;
  readonly status: CompanionStatus;
  onStatusChange(listener: (s: CompanionStatus) => void): () => void; // 解除関数
  requestChat(
    messages: ChatMessage[],
    options?: { model?: string; onDelta?: (delta: string, full: string) => void },
  ): Promise<string>;
  requestTts(params: { text: string; model?: string; voice?: string }): Promise<Blob>;
}
export function getCompanionClient(): CompanionClient;
```

実装要件:
- `connect`: `ensureMistNode()` → `addNodeEventHandler(handler)` → `node.joinRoom(roomId)`
  → status `joining`→`searching` → consumer_hello を room スコープで broadcast
  (`node.sendMessage(null, encode({v:1,type:"consumer_hello"}), DELIVERY_RELIABLE, roomId)`)。
- ハンドラのフィルタ: `roomId !== undefined && roomId !== aiRoomId → return`。
  roomId 未添付の EVENT_RAW は**内容で判別**: 先頭バイトが `{`(0x7B)のときだけ
  `decode()` を試す(collab の Yjs メッセージは 0x00/0x01 プレフィックスなので衝突しない)。
- `provider_hello` 受信: 最初の送信元を providerId に採用、`consumer_hello` を当該ピアへ
  unicast、status `connected`(models 添付)。
- `EVENT_PEER_DISCONNECTED` で providerId が消えたら: 両サービス `rejectAll(...)` →
  status `searching` に戻す。
- provider 待ちタイムアウト(mistai client.ts の providerWaitTimeoutMs 既定値を踏襲)で
  status error / code PROVIDER_NOT_FOUND。
- `requestChat`/`requestTts`: 未接続なら接続完了を待つ(タイムアウト付き)。SendFn は
  `(toId, msg) => node.sendMessage(toId, encode(msg), DELIVERY_RELIABLE, aiRoomId)`。
  llm_* → ConsumerService.handleMessage、tts_/stt_/voice_error → VoiceConsumerService へ
  ルーティング(mistai client.ts:198-203 と同じ振り分け)。
- `disconnect`: unsubscribe → `node.leaveRoom(aiRoomId)`(スコープ化必須)→
  rejectAll → status idle。**no-arg leaveRoom は絶対に呼ばない**(collab を殺す)。
- テスト: fake node(joinRoom/sendMessage/leaveRoom 記録+ハンドラ手動発火)で
  発見フロー(hello→connected)、provider 切断→searching、チャット往復
  (llm_response_chunk/done を注入)、leave がルームスコープであること。

## B: src/lib/ai/speech.ts

```ts
/** tc-assistant2 main.tsx:127 の移植: /(?<=[。！？!?\n])/(全角！？を含む)で分割
 *  → trim → 空行除去 */
export function splitSpeechLines(text: string): string[];

export interface SpeakCallbacks {
  onLineStart?(line: string, index: number): void;
  /** 再生を開始する HTMLAudioElement を渡す(リップシンク接続用)。行ごとに新しい要素。 */
  onAudioStart?(audio: HTMLAudioElement): void;
}
/** 行ごとに synthesize → 順次再生。次行の合成は再生中に先行実行(1行先読み)。
 *  1行の失敗は skip して継続。signal abort で即停止(pause + URL revoke)。 */
export async function speakLines(
  lines: string[],
  synthesize: (line: string) => Promise<Blob>,
  signal: AbortSignal,
  callbacks?: SpeakCallbacks,
): Promise<void>;
```

Blob → `URL.createObjectURL` → `new Audio(url)` → 再生完了(ended/error)で revoke。
tc-assistant2 の playAudioToEnd 相当の cleanup 規律を踏襲。

## B: src/lib/ai/lipSync.ts

```ts
export interface LipSyncHandle { dispose(): void; }
/** audio 要素の実音量から口の開き(0..1)を推定して onLevel に毎フレーム通知する。
 *  AudioContext が使えない環境では擬似モード(再生中 sin 波ゆらぎ)へフォールバック。 */
export function attachLipSync(audio: HTMLAudioElement, onLevel: (level: number) => void): LipSyncHandle;
```

- モジュール共有 AudioContext を lazy 生成(+`resume()` 試行)。
  `createMediaElementSource(audio)` → `AnalyserNode`(fftSize 1024,
  smoothingTimeConstant 0.6)→ **destination にも接続**(しないと無音になる)。
- rAF ループ: time-domain RMS → ノイズフロア 0.01 差し引き ×12 で 0..1 に正規化 →
  `value += (target - value) * (1 - Math.exp(-k * dt))`(attack k=25, release k=10)。
- dispose: rAF 停止、ノード disconnect、`onLevel(0)`。
- 擬似モード: `!audio.paused` の間 `0.35 + 0.3 * sin(t * 14)`、ended/pause で 0。
- ブラウザ専用のためテスト不要。

## C: companion.ts / vrmLoader.ts — 口の駆動

`Companion` に追加:

```ts
  /** 発話リップシンク用の口の開き(0..1)。毎フレーム上書きされる前提の生値。 */
  setMouthLevel?(level: number): void;
```

`createVrmCompanion`: `expressionMap["aa"]` があるときだけ有効。内部変数に保持し、
`update()` 内で **`vrm.update(deltaSeconds)` より前に**
`vrm.expressionManager?.setValue("aa", level)` を適用(expressionManager の適用は
vrm.update 内で走るため)。golem(プレースホルダ)側は未実装のままでよい(optional)。

## C: 会話 UI — CompanionTalkPanel.tsx + AvatarScreen.tsx

> 2026-07-07 更新: トークボタンとパネルのホストは `ARCameraScreen.tsx` から Avatar
> ハブ `src/components/avatar/AvatarScreen.tsx` に移動した(撮影オーバーレイには
> トーク UI は無い)。`CompanionTalkPanel.tsx` 自体は `src/components/ar/` のまま、
> フォルダ境界を越えて import して再利用する。以下の「live モード」はハブのステージ
> 表示中に読み替える。

- ハブのステージで VRM コンパニオンが表示中かつ `isAiConfigured()` のとき、トークボタン
  (lucide `MessageCircle`)を表示 → パネル開閉。未設定時は非表示(ボタンごと出さない)。
- パネルは既存 `.ar-chooser-*` ボトムシートと同系統の M3 ダークUI(`ar.css` に `.ai-talk-*`)。
  構成: ヘッダ(ステータスドット+閉じる)/ メッセージリスト(user/assistant バブル、
  assistant は onDelta でストリーミング描画)/ 入力行(text input + 送信。connected 時のみ
  有効)/ 発話中は停止ボタン。
- ステータスドット色: idle=グレー, joining/searching=アンバー(pulse), connected=緑,
  error=赤(+エラーメッセージ小さく表示。code があれば i18n、無ければ生 message)。
- 接続ライフサイクル: パネル初回オープンで `getCompanionClient().connect(settings.roomId)`。
  AR 画面 unmount で `disconnect()`(パネル閉じただけでは切らない)。
- 送信フロー(tc-assistant2 main.tsx:920-1005 の世代ガードパターンを踏襲):
  1. requestRef インクリメント + AbortController。進行中の発話は abort。
  2. system プロンプト + 履歴(直近12メッセージ)+ 新規 user 発話を `runNetworkTask`
     (下記「AI Network Task」節参照)の `contextText`/`input` に載せて送信。
     onDelta(マージ済み全文)でバブル更新。
  3. 完了後、`settings.ttsEnabled` なら `splitSpeechLines(reply)` → `speakLines(...)`。
     `synthesize = (line) => client.requestTts({ text: line, voice: settings.voice || undefined })`。
     `onAudioStart(audio)` で `attachLipSync(audio, (v) => companion.setMouthLevel?.(v))`、
     行の終わり/abort で handle.dispose()。
  4. エラーは assistant バブルの代わりに小さなエラー行(i18n)。console.warn は
     `tc-travel:` プレフィックス。
- system プロンプト(コードに英語で埋める。ユーザー persona は末尾に連結):
  「You are the user's avatar companion in a travel app, appearing as their VRM
  character. Reply in <言語名(profile 言語)>. Keep replies short and conversational
  (1–3 sentences). Plain text only — no markdown, no emoji spam.」+ persona。
- 履歴はパネルの state(メモリのみ)。永続化しない。

## C: 設定 UI — guild/SettingsSection.tsx + guild/AiSettingsPanel.tsx

2026-07-19 更新: tik-choco 共通の LLM 設定 UI 仕様
(tc-docs/drafts/llm-settings-common-v1.md、参照実装 tc-translate)に合わせてリニューアル。
「AIコンパニオン」セクションの中身は新規 `guild/AiSettingsPanel.tsx` に切り出し、
**AI接続 / AI Network / タスク の3タブ + ツールチップ方式**へ再構成した
(`SettingsSection.tsx` は `<AiSettingsPanel />` を呼ぶだけ)。

tc-travel の AI コンパニオンは AI Network ルーム越しにしか provider と話さない
(直接 HTTP を叩くコードが元々存在しない)ため、参照実装にある2点は意図的に持ち込んでいない
(§5.3 チェックリスト項目7 — 存在しないネットワーク機能を新規追加しない):
- AI接続タブにモデル一覧の自動取得/接続テストが無い(モデル名は手入力)。
- AI Networkタブに「provider として参加する」ロールカードが無い(tc-travel は
  consumer 専用で、provider として広告する仕組みを持たない)。
また、共有設定 `tc-shared-llm-config-v1` の provider/preset は他アプリとも共有される
append-only 対象ではなく、ユーザーが直接 CRUD する対象として `src/lib/drive/llmConfigEdit.ts`
(tc-translate の同名ファイルの移植)を新設して編集する。カードは常時編集フォーム表示
(view/edit 切り替え無し)の縦積みリストで簡略化している(tc-translate/tc-pdf-viewer の
クリックで開くインライン編集とは異なる、意図的な簡略化)。

- **AI接続タブ**: 接続先(provider: label/baseUrl/apiKey)とモデル(preset:
  label/providerId/model)をそれぞれ独立した縦積みリストとして CRUD。バッジ(`.task-badge`)で
  既定 / タスク割当 / Network由来を表示。
- **AI Networkタブ**: Room ID(`aiSettings.roomId` のローカル上書き。空なら
  `tc-shared-llm-config-v1` の `network.roomId` にフォールバック — 既存仕様のまま、
  ラベルの `data-tip` で上書き規則を説明)+ consumer ロールカード1枚
  (`getCompanionClient().status` を購読して現在の接続状態を表示するのみ。
  Settings 画面から能動的に `connect()` は呼ばない — 実際の接続開始は
  引き続き `CompanionTalkPanel` を開いたときだけ)。
- **タスクタブ**: 行は「プラン」(`AiTaskRole` の `"orchestrator"`)/「応答」(`"worker"`)の
  2行(下記「AI Network Task」節参照)。ラベルは1語、説明は `data-tip` ツールチップへ。
  reasoning_effort セレクトは持たない —
  vendored `src/vendor/mistai` の wire protocol(`llm_request`)に reasoning_effort
  フィールドが無く、vendor 編集禁止のため送信経路が存在しないための意図的な省略
  (§5.3 チェックリスト項目6からの明示的な逸脱)。

## C: i18n

新規キー(`ar.i18n.ts` と guild 側 i18n に、**8言語すべて**: en/ja/zh/ko/es/fr/de/pt):
`ar.talk.open`(トークボタン aria)、`ar.talk.title`、`ar.talk.placeholder`、
`ar.talk.send`、`ar.talk.stopSpeaking`、`ar.talk.status.idle/joining/searching/connected/error`、
`ar.talk.error.request`(依頼失敗)、`ar.talk.notConfigured`、
`settings.ai.title`、`settings.ai.tab.connection/network/tasks`、
`settings.ai.connection.*`(接続先/モデル CRUD の各文言)、
`settings.ai.network.*` + `settings.ai.roomId/roomIdTip/roomIdSharedHint`、
`settings.ai.tasks.plan/planTip/response/responseTip/presetUnset`、
`settings.ai.voice/persona/ttsEnabled`。
(キー名はこのとおり。文言は各エージェントが自然な訳を書く。)

## AI Network Task — orchestrator → worker fan-out

`CompanionTalkPanel.tsx` の送信は単発 `requestChat` ではなく、`src/lib/ai/networkTask.ts`
の `runNetworkTask()` を介した orchestrator(計画のみ)→ worker×n(並列実行)の
fan-out で行う。tc-translate の `simultaneousTranslate` と同形の設計で、高価なモデルは
「タスクを最大 `MAX_NETWORK_TASK_WORKERS`(=4)件のサブタスクに分割する」という小さな
JSON プランプロンプトにしか使われず、実際の生成トークンはすべて安価な worker モデルが
消費する。plan の生成に失敗した場合は単一 worker への直接フォールバック(`plan: null`)、
個々の worker の失敗はそのスロットにプレースホルダを残して継続し、全滅した場合のみ
呼び出し元に throw する。

- モデル解決は `aiSettings.ts` の `resolveTaskModel(role, settings)`(role は
  `"orchestrator" | "worker"`、UI上は「プラン」/「応答」)。優先順位:
  `settings.tasks[role].presetId`(共有 `tc-shared-llm-config-v1` のプリセットを
  `resolvePreset` で解決)→ レガシー `settings.model` → 共有設定自身の
  `defaultPresetId`(同じく `resolvePreset` で解決)→ 空文字列(`model` フィールドを
  送らない = provider 側の既定モデルで応答)。特定ベンダーのモデル名をハードコードした
  フォールバックは持たない(§5.3 チェックリスト項目8)。
- `CompanionTalkPanel` はコンパニオンの system プロンプト(`buildSystemPrompt(persona)`)
  と直近履歴(`HISTORY_LIMIT`=12)を `runNetworkTask` の `contextText` に
  「Persona/system context: ...」+「Recent conversation: ...」としてまとめて渡す
  (`runNetworkTask` 自身は orchestrator/worker 用の system プロンプトを内部で
  持つため、キャラ設定は contextText 経由で worker に届ける)。新規ユーザー発話は
  `input` にそのまま渡す。
- `CompanionClient` は `ChatClient`(`requestChat(messages, { model, onDelta })`)と
  構造的に互換なので、`getCompanionClient()` のインスタンスをそのまま
  `runNetworkTask({ client, ... })` に渡せる。
- ストリーミング: `runNetworkTask` の `onDelta` はマージ済み全文(サブタスク単位の
  差分ではない)を都度渡してくるので、パネル側はそれをそのまま assistant バブルへ
  上書き表示する。abort は `AbortController` の `signal` をそのまま渡し、
  停止ボタン/アンマウント時の既存の世代ガード(requestId + `isCurrent()`)と併用する。
- TTS(`speakLines`)には `runNetworkTask` の戻り値 `text`(= マージ済み最終テキスト)を
  そのまま渡す。挙動は単発 `requestChat` 時と同じ。

## 共通ルール

- 新規 npm 依存の追加禁止。vendor 済みコードの編集禁止。
- localStorage キーは `tc-travel:<name>`。モジュールロード時に localStorage を触らない。
- console 出力は `tc-travel:` プレフィックス。コミットはオーケストレーターのみが行う。
- コード中にローカルパス・ユーザー名を書かない。
- `npx tsc -b` と `npm test` が通ること(各エージェント、完了前に必ず実行)。
