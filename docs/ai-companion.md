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
export interface AiCompanionSettings {
  /** provider が announce している mist ルーム id。空文字 = 機能未設定 */
  roomId: string;
  model?: string;    // LLM モデル名(空/undefined = provider 既定)
  voice?: string;    // TTS ボイス名(同上)
  persona?: string;  // システムプロンプトに足すキャラ設定自由文
  ttsEnabled: boolean; // 既定 true
}
export const AI_SETTINGS_KEY = "tc-travel:aiCompanion";
export function loadAiSettings(): AiCompanionSettings;   // 破損/不在 → 既定値
export function saveAiSettings(settings: AiCompanionSettings): void; // 失敗は console.warn で握る
export function isAiConfigured(settings?: AiCompanionSettings): boolean; // roomId.trim() !== ""
```

localStorage アクセスはモジュールロード時に行わない(vitest node 環境)。

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

## C: 会話 UI — CompanionTalkPanel.tsx + ARCameraScreen.tsx

- live モードで VRM コンパニオンが表示中かつ `isAiConfigured()` のとき、トークボタン
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
  2. system プロンプト + 履歴(直近12メッセージ)+ 新規 user 発話で `requestChat`
     (`model: settings.model || undefined`、onDelta でバブル更新)。
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

## C: 設定 UI — guild/SettingsSection.tsx

「AIコンパニオン」セクションを追加(既存セクションの M3 スタイル踏襲):
ルームID(text)、モデル(text, 任意)、ボイス(text, 任意)、キャラ設定(textarea, 任意)、
音声で喋る(スイッチ)。`loadAiSettings`/`saveAiSettings` を使用。変更は即保存。

## C: i18n

新規キー(`ar.i18n.ts` と guild 側 i18n に、**8言語すべて**: en/ja/zh/ko/es/fr/de/pt):
`ar.talk.open`(トークボタン aria)、`ar.talk.title`、`ar.talk.placeholder`、
`ar.talk.send`、`ar.talk.stopSpeaking`、`ar.talk.status.idle/joining/searching/connected/error`、
`ar.talk.error.request`(依頼失敗)、`ar.talk.notConfigured`、
`settings.ai.title/roomId/roomIdHint/model/voice/persona/ttsEnabled`。
(キー名はこのとおり。文言は各エージェントが自然な訳を書く。)

## 共通ルール

- 新規 npm 依存の追加禁止。vendor 済みコードの編集禁止。
- localStorage キーは `tc-travel:<name>`。モジュールロード時に localStorage を触らない。
- console 出力は `tc-travel:` プレフィックス。コミットはオーケストレーターのみが行う。
- コード中にローカルパス・ユーザー名を書かない。
- `npx tsc -b` と `npm test` が通ること(各エージェント、完了前に必ず実行)。
