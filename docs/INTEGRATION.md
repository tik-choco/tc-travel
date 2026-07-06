# tc-storage 連携仕様 (orchestrator authored — binding contract)

tc-travel を tik-choco アプリファミリー (tc-note / tc-storage / tc-pdf-viewer) の
同一オリジン連携規約 (`protocol/docs/data-contracts/docs/SHARED_BUS.md`) に参加させる。
前提: 本番は同一オリジンの別サブパスに deploy され、localStorage / BroadcastChannel /
OPFS (`mistlib-blocks`) が物理的に共有される。dev サーバー同士は別オリジンなので
連携確認は build 済み dist を単一静的サーバー配下に並べて行う。

## 決定事項

1. **wasm ビルド統一**: tc-storage の vendored mistlib-wasm を tc-travel と同じビルド
   (commit `e9ae5a4f017f2a29b1ed14cc2ce918b8d26d787c`) に更新する。OPFS ブロック
   フォーマット互換を型ではなくバイナリ同一性で保証するため。
2. **tc-travel → tc-storage (書き)**: 写真を tc-storage ネイティブ形式
   (AES-GCM 暗号化 FileBundle / FolderBundle) で mist storage に書き、共有バスの
   新トピック **`travel-export`** で通知する。tc-storage 側は subscribe して
   既存 CRDT マージでワークスペースに取り込む。tc-travel が
   `tc-storage-snapshot-v1` を直接書くことは**禁止** (開いている tc-storage タブの
   スナップショット保存と競合するため)。
3. **tc-storage → tc-travel (読み)**: tc-travel は `tc-storage-snapshot-v1` と
   `tc-storage-folder-keys-v1` を**読み取り専用**で参照し、`storage_get` + 復号で
   ファイル実体を取得する (最初のユースケース: ドライブ内 .vrm をアバターとして召喚)。
4. **ノード識別子**: `tc-storage-did-identity-v1` が存在すればその `did` を
   tc-travel の mist nodeId / エクスポート記録の originNode に採用する
   (ファミリー共通 DID 規約への相乗り)。無ければ従来の `tc-travel:nodeId`。

## 共有バス契約 (topic: `travel-export`)

- localStorage キー: `tc-shared-travel-export-v1`
- `SharedRecord.cid`: 暗号化 **FolderBundle** の mist CID
- `SharedRecord.from`: `"tc-travel"` (SharedAppName union に追加)
- `SharedRecord.meta`:
  ```ts
  {
    folderId: string;      // TC Travel フォルダの安定 id
    folderName: string;    // "TC Travel"
    passphrase: string;    // フォルダ鍵 (同一オリジン信頼境界内での受け渡し)
    fileCount: number;
    exportedAt: string;    // ISO 8601
  }
  ```
- 冪等性: 受信側は同一 cid の再通知をスキップしてよい。マージ自体も
  per-field LWW なので重複適用は無害。

## tc-travel 側ファイル配置 (`src/lib/tcstorage/`)

| ファイル | 所有 | 内容 |
|---|---|---|
| `types.ts` | Agent A | tc-storage `src/storage/domain.ts` から VersionStamp / FolderColor / FolderRecord / FileRecord / StorageSnapshot / FolderBundle / FileBundle を**逐語**移植 |
| `crypto.ts` | Agent A | tc-storage `src/crypto/crypto.ts` + `cryptoEncoding.ts` から encryptJson / decryptJson / sha256Hex / bytesToBase64 / base64ToBytes を移植 (payload 形式は完全互換必須: AES-GCM 256, PBKDF2-SHA256 210000, salt16/iv12, base64) |
| `sharedBus.ts` | Agent A | tc-storage `src/storage/sharedBus.ts` の vendor コピー。`APP_NAME = 'tc-travel'`、`SharedAppName` に `'tc-travel'` を追加。ヘッダの vendor 先一覧に tc-travel を追記 |
| `export.ts` | Agent A | 下記 API |
| `reader.ts` | Agent B | 下記 API |

### export.ts (Agent A)

```ts
export const TRAVEL_EXPORT_TOPIC = "travel-export";
/** localStorage `tc-travel:tcStorageExport` = { folderId, passphrase, files: FileRecord[] }
 *  files は dataUrl を strip 済み・lastCid 付きの正本 (FolderBundle 再構築用)。 */
export function isPhotoExported(photoId: string): boolean;
/** 1枚エクスポート。失敗は throw。 */
export async function exportPhotoToTcStorage(input: {
  photoId: string;   // FileRecord.id を `file-travel-<photoId>` に固定 → 再実行で重複しない
  bytes: Uint8Array; // JPEG
  caption: string;   // ファイル名の材料 (空なら日時)
  at: number;        // 撮影 epoch ms
}): Promise<void>;
```

手順: (1) フォルダ確保 — 初回は tc-storage `makeFolder` 相当
(id `folder-travel-<uuid>`, name "TC Travel", color 'teal', encrypted true,
sharedRoomId は tc-storage の createFolder (`src/app/appFolderActions.ts:100-117`) と
同じ流儀で生成、全フィールド fieldVersions を {updatedAt: now, nodeId} でスタンプ) し
passphrase (24 random bytes base64url — tc-storage `folderKeys.ts` と同形式) を生成、
`tc-travel:tcStorageExport` に保存。
(2) FileRecord 構築 (`makeFileFromDataUrl` 相当、checksum = sha256Hex(bytes)、
dataUrl = base64 data URL)。(3) FileBundle を encryptJson → `storage_add`
(name `<fileId>.tc-file.enc.json`) → lastCid をスタンプ。(4) 全 FileRecord
(dataUrl strip 済) で FolderBundle を encryptJson → `storage_add`
(name `<folderId>.tc-folder.enc.json`)。(5) `publishShared(TRAVEL_EXPORT_TOPIC,
folderCid, meta)`。mist は `ensureMistNode()` (lib/mistNode.ts) 経由。

### reader.ts (Agent B)

```ts
export interface TcStorageFileEntry {
  file: FileRecord;          // dataUrl は無い (persisted snapshot は strip 済み)
  path: string;              // "フォルダ/サブフォルダ" 表示用
  passphrase: string | null; // 自フォルダ鍵 → 祖先フォルダ鍵の順で解決。null = 復号不可
}
/** tc-storage ワークスペースのファイル一覧 (deletedAt 除外)。
 *  extensions 指定時は小文字拡張子でフィルタ (例 [".vrm"])。 */
export function listTcStorageFiles(options?: { extensions?: string[] }): TcStorageFileEntry[];
/** lastCid → storage_get → 暗号化 envelope JSON → decryptJson<FileBundle> → dataUrl → bytes。
 *  lastCid か passphrase が無い / 復号失敗は throw。 */
export async function loadTcStorageFileBytes(entry: TcStorageFileEntry): Promise<Uint8Array>;
```

読むキー: `tc-storage-snapshot-v1` (StorageSnapshot)、`tc-storage-folder-keys-v1`
(Record<folderId, passphrase>)。**書き込み禁止**。

## UI

- **Agent A**: アルバム PhotoViewer に「TC Storage に保存」アクション
  (lucide `HardDriveDownload`)。実行中スピナー、成功/失敗トースト、保存済みなら
  ボタンを保存済み表示に。i18n 8言語必須 (album.i18n.ts)。
- **Agent B**: AR 画面の VRM 読み込み (empty ヒーロー + live の Upload ボタン) を
  選択シートに変更: 「デバイスから選ぶ」/「TC Storage から選ぶ」。後者は
  .vrm ファイルの `.list-item` 一覧 (復号不可・lastCid 無しは無効表示)。
  tc-storage スナップショットが無い/.vrm が0件なら従来どおり直接 file input。
  i18n 8言語必須 (ar.i18n.ts)。

## tc-storage 側 (Agent S)

1. `src/vendor/mistlib-wasm/` の4ファイルを tc-travel
   `src/vendor/mistlib/pkg/` からコピーで置換 + BUILD_INFO.txt 更新
   (commit e9ae5a4…, "unified with tc-travel")。`strings` で `/Users` などの
   ローカルパスやユーザー名が漏れていないこと確認必須。ビルド+テスト green 必須。
2. `sharedBus.ts` の `SharedAppName` に `'tc-travel'` 追加。
3. `travel-export` 購読: 起動時 `readShared` + `subscribeShared`。
   `tc-storage-travel-import-cid-v1` (localStorage) に取込済み cid を記録し重複スキップ。
   取込 = `loadEncryptedFolderFromMist(cid, meta.passphrase)` → フォルダ鍵登録
   (folderId → passphrase) → 既存の FolderBundle 受入/マージ機構
   (pending share の取込コード) を再利用してスナップショットへ CRDT マージ →
   activity 追加。既存 UI がそのまま新フォルダを表示すること。

## 共通ルール

- 新規 npm 依存の追加禁止 (ファミリー規約「ランタイム依存禁止」)。
- tc-travel 側の新 UI 文言は 8言語 (en/ja/zh/ko/es/fr/de/pt) 全部。
- 例外は握りつぶさず UI トースト or console.warn。俺様形式のログ prefix は
  tc-travel 側 `tc-travel:`, tc-storage 側は既存の logging util。
- コミットはオーケストレーター (ユーザー承認後)。エージェントはコミットしない。
