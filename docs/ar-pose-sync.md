# AR コンパニオン座標同期(共有仮想ステージ)実装契約

同じルームのメンバーが AR カメラを開いている間、各自の VRM コンパニオンの
位置・向き・スケールを同期し、**全員の AR ビューに全員のコンパニオン**が
写るようにする(集合写真用)。参照実装は tc-vrsns2 の
RoomSession/protocol/RemotePlayerView(調査済み・数値もそこから採用)。

この文書は並列実装エージェント間の**拘束契約**。公開シグネチャ・定数は
このとおりに実装すること。

## 決定済みアーキテクチャ

- **共有座標系 = シーン座標(共有仮想ステージ)**。tc-travel の AR は
  非トラッキング(固定仮想カメラ、arScene.ts:20-22)なので、シーン座標を
  そのまま全員の共通フレームとして扱える。実世界アンカー合わせは不要。
- **ポーズは MSG_POSE=2**: collab の既存 raw チャンネル(1バイト varUint
  種別プレフィックス)に第3の種別を追加。**DELIVERY_UNRELIABLE**・
  ルームスコープ・broadcast(toId null)。10Hz、変化がなくても送り続ける
  (tc-vrsns2 同様、UNRELIABLE の再送＋生存信号を兼ねる)。
- **VRM 本体は mist storage**: `storage_add` → cid を Member(`vrmCid`)+
  awareness に載せる。`avatarCid` の実装パターン(store.ts:59-94、
  ""=クリア sentinel、Y.Map 恒久+awareness 即時ミラー)を踏襲。
- **awareness にポーズを載せない**(全 state 再送 × RELIABLE で高頻度に不向き)。
- ポーズの key は **memberId**(profile.id、payload に含める)。fromId
  (mist nodeId)は使わない(再接続で変わり得るため)。

## ファイル所有権

| エージェント | 所有ファイル |
|---|---|
| D (net) | `src/lib/collab.ts`, `src/lib/store.ts`, `src/lib/types.ts`, `src/lib/__tests__/pose.test.ts`(新規) |
| E (ar) | `src/components/ar/arScene.ts`, `remoteCompanions.ts`(新規), `ARCameraScreen.tsx` |

vendor は全員編集禁止。コミットはオーケストレーターのみ。

## D: 型 — types.ts

`Member` に追加: `vrmCid?: string;`(コメント: AR コンパニオン VRM の
mist storage cid。"" はクリア直後の sentinel — avatarCid と同規約)。

## D: collab.ts — MSG_POSE チャンネル

```ts
export const MSG_POSE = 2;

/** 共有仮想ステージ上のコンパニオン姿勢。数値は有限・|値|<=100 に clamp。 */
export interface CompanionPose {
  memberId: string; // Member.id (安定 id)
  x: number; y: number; z: number; // scene 座標
  ry: number;  // yaw ラジアン
  s: number;   // uniform scale (0.1..10 に clamp)
  t: number;   // 送信側 epoch ms(古い順序外パケットの破棄用)
}

class CollabSession {
  /** 参加中のみ送信。JSON encode → MSG_POSE prefix → DELIVERY_UNRELIABLE
   *  broadcast(room スコープ)。throttle は呼び出し側の責務。 */
  sendPose(pose: Omit<CompanionPose, "memberId" | "t">): void;
  /** 受信ポーズ購読。解除関数を返す。自分の memberId のポーズは配らない。 */
  onPose(listener: (pose: CompanionPose) => void): () => void;
}
```

実装要件:
- `DELIVERY_UNRELIABLE` を wrapper から import(現在は RELIABLE のみ)。
- handleRawMessage の分岐チェーンに MSG_POSE を追加。デコードは防御的:
  JSON parse 失敗/型不一致/非有限数は黙って捨てる(console 不要、高頻度)。
  受信値も clamp(|pos|<=100, s∈[0.1,10])。`t` が同一 member の直近より
  古ければ破棄(UNRELIABLE の順序逆転対策)。
- memberId は sendPose が自分の memberId を自動付与(コンストラクタで既知)。
- leave() で listener をクリア。
- 既存の Yjs 経路(MSG_SYNC/MSG_AWARENESS)には一切触れない。

## D: store.ts — VRM cid の公開

```ts
/** AR コンパニオンの VRM を共有ストレージへ発行し、cid を members Y.Map と
 *  awareness にミラーする。setMemberAvatarBytes と同じ構造。
 *  storage_add は content-addressed なので同一バイト列の再発行は冪等。 */
export async function setMemberVrmBytes(bytes: Uint8Array): Promise<void>;
/** 現在のセッションの sendPose / onPose / 自分の memberId へのアクセサ。
 *  セッション未参加なら sendPose は no-op、onPose は即 no-op 解除関数。 */
export function sendCompanionPose(pose: Omit<CompanionPose, "memberId" | "t">): void;
export function onCompanionPose(listener: (pose: CompanionPose) => void): () => void;
export function useMemberVrmCids(): Map<string, string>; // memberId -> vrmCid("" とundefined は除外)
```

`useMemberVrmCids` は useMembers と同じ三方マージ規約(awareness の "" sentinel
が Y.Map の古い値を隠す)に従うこと。ファイル名は `companion-<memberId>.vrm`
で storage_add。

## D: テスト — pose.test.ts

fake node(既存 mistDispatch.test.ts のパターン)で:
encode→handleRawMessage→listener のラウンドトリップ、自分の memberId の
エコー抑止、malformed JSON / 非有限数 / 巨大値 clamp / 古い `t` の破棄、
sendMessage が MSG_POSE prefix + UNRELIABLE + roomId 付きで呼ばれること、
leave 後に listener が呼ばれないこと。

## E: arScene.ts — 複数コンパニオン

単一 `companion` スロットを keyed コレクションに拡張(後方互換維持):

```ts
export interface ArScene {
  // 既存: setCompanion(c) は key "local" の addCompanion と等価に再実装
  setCompanion(companion: Companion | null): void;
  addCompanion(key: string, companion: Companion): void;   // 同 key は差し替え(旧は remove のみ、dispose は呼び出し側)
  removeCompanion(key: string): void;
  ...既存メンバー
}
```

render loop は全 companion の `update(delta, elapsed)` を呼ぶ。dispose() は
全コンパニオンを scene から外す(dispose 自体は所有者側)。

## E: remoteCompanions.ts(新規)— リモート表示マネージャ

```ts
export interface RemoteCompanionsManager {
  /** members の vrmCid マップ更新(ロード/差し替えのトリガ)。 */
  setVrmCids(cids: Map<string, string>): void;
  /** 受信ポーズの反映(onCompanionPose から)。 */
  applyPose(pose: CompanionPose): void;
  /** 毎フレーム呼ぶ(平滑化・期限切れ削除)。arScene 側 update と別掛けでなく、
   *  Companion.update 内で行ってもよい — 実装に任せる。 */
  dispose(): void;
}
export function createRemoteCompanions(scene: ArScene, ownMemberId: string): RemoteCompanionsManager;
```

要件:
- member ごと: 初回ポーズ受信で **placeholder golem を即表示**
  (placeholderCompanion.ts 再利用)→ vrmCid があれば `ensureMistNode()` +
  `storage_get(cid)` → `loadVrmFromBytes` → `createVrmCompanion` で差し替え。
  差し替えは token ガード(古い fetch が新しい VRM や退場後を上書きしない —
  tc-vrsns2 World.setRemoteAvatar の手法)。ロード失敗は golem のまま
  console.warn 1回。
- ポーズ適用は target 保持 + 毎フレーム指数平滑:
  `alpha = 1 - Math.exp(-k * delta)`、位置 k=12、yaw k=10(最短角経由)、
  scale も k=12。初回 or 距離 > 3 は snap(tc-vrsns2 SNAP 手法)。
- **期限切れ**: 最終受信から 5000ms でシーンから削除+dispose(相手が AR を
  閉じた/退室)。チェックは update 内で良い。
- キーは memberId。`arScene.addCompanion("remote:" + memberId, ...)`。
- 自分(ownMemberId)のポーズは無視。

## E: ARCameraScreen.tsx — 配線

> 2026-07-07 更新: `ARCameraScreen.tsx` は Avatar ハブ(`src/components/avatar/
> AvatarScreen.tsx`)から開く**撮影専用オーバーレイ**になった。以下の「live モード」
> は廃止され、オーバーレイのマウント中(常時 live 相当)に読み替える。group-photo /
> pose-sync のロジックとセマンティクスはこのファイルに残っており不変。

オーバーレイのマウント中 & セッション参加中のみ:
1. `createRemoteCompanions(arScene, profile.id)` を live mount effect で生成、
   unmount で dispose。
2. `onCompanionPose(m.applyPose)` 購読(解除も)。`useMemberVrmCids()` を
   effect で `m.setVrmCids(...)` に流す。
3. **送信ループ**: 100ms interval で `companionRef.current?.root` から
   `{x: p.x, y: p.y, z: p.z, ry: rotation.y, s: scale.x}` を `sendCompanionPose`。
   live モード終了/unmount で停止。VRM 未ロード(placeholder)でも送る
  (golem が写るのも仕様として可)。
4. **VRM 発行**: applyVrmBytes 成功時に fire-and-forget
   `setMemberVrmBytes(bytes)`(失敗は console.warn、UI には出さない)。
5. **初期配置**: セッション参加中で自分のコンパニオンが原点(未操作)のとき、
   メンバー一覧(memberId ソート)内の自分の index から
   `x = (index - (n-1)/2) * 0.9` に初期オフセット(全員が原点で重なるのを
   回避)。ジェスチャ操作後は上書きしない(position が原点かどうかで判定)。
6. 写真キャプチャは変更不要(scene に居るものは全部写る)。
7. 新規の文字列 UI は無し(i18n 追加不要)。ステータス表示も v1 では省略。

## 共通ルール

- 新規 npm 依存禁止 / vendor 編集禁止 / `tc-travel:` console プレフィックス /
  localStorage をモジュールロード時に触らない / `npx tsc -b` と `npm test`
  が通ること。
- 数値定数(10Hz、k=12/10、snap 3、expiry 5000ms、clamp 100)は本契約が正。
