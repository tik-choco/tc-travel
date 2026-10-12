# ドライブ連携仕様 (orchestrator authored — binding contract)

tc-travel は tik-choco アプリファミリーの同一オリジン連携規約
(`protocol/docs/data-contracts/docs/SHARED_BUS.md`) に従い、**アプリ名ではなく
能力(トピック)に対して**結合する。原則は **publish, don't peek**:

- 他アプリの `tc-<app>-*` 名前空間の localStorage キーを読まない・書かない。
- アプリ間で受け渡すものはすべて `tc-shared-<topic>-v1` の共有バスレコード経由。
- 相手が「どのアプリか」に依存しない。`SharedRecord.from` は表示・デバッグ用情報。
- コード・UI 文言にも相手アプリ名を入れない(UI は「ドライブ」のような機能名)。

前提: 本番は同一オリジンの別サブパス配信で localStorage / BroadcastChannel /
OPFS (`mistlib-blocks`) が共有される。vendored mistlib-wasm はファミリー全アプリで
同一ビルドを保つ (現行 commit `e9ae5a4…`)。

## トピック契約

### `folder-export` (書き手: 任意のアプリ / 読み手: ドライブ実装アプリ)

写真等のファイル群を「暗号化フォルダバンドル」としてドライブ側ワークスペースへ
受け渡す。バンドル形式は `protocol/docs/data-contracts/docs/encrypted-bundle.md` を正とする。

- `cid`: 暗号化 FolderBundle の mist CID
- `meta`: `{ folderId, folderName, passphrase, fileCount, exportedAt }`
- 読み手は folderId ごとの取込済み cid マップ
  (読み手アプリの名前空間キー、tc-storage は `tc-storage-folder-import-cids-v1`)
  で重複取込をスキップ。取込は per-field LWW マージなので重複適用も無害。
- 単一 localStorage レコードなので複数アプリが同時多発的に publish すると
  「最新の告知」だけが残る。取りこぼしはバスの通知(3経路)で実質カバーされる
  設計とし、キュー保証はしない。

### `drive-index` (書き手: ドライブ実装アプリ / 読み手: 任意のアプリ)

ドライブ内ファイルの索引。これにより他アプリはドライブアプリの内部キー
(スナップショット・フォルダ鍵)を**一切読まずに**ファイルへアクセスできる。

- `cid`: 暗号化索引の mist CID。CID に保存するのは AES-GCM エンベロープのみ。
- `meta`: `{ format: "tc-storage/drive-index/encrypted/1", indexKey, count, updatedAt }`。
  `indexKey` は発行ごとに生成するランダムな32バイトの base64 鍵で、同一オリジンの
  共有メタデータにのみ保持する。CID ストレージやネットワークメッセージには絶対に含めない。
- 復号後の索引: `{ version: 1, updatedAt, files: DriveIndexEntry[] }`。
  CID を storage_get → エンベロープ JSON を解釈 → meta.indexKey で認証付き復号
  → 復号済み JSON を解釈 → files を検証・抽出する (decrypt-before-parse)。
  ```ts
  interface DriveIndexEntry {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    lastCid: string;    // 暗号化 FileBundle の CID
    path: string;       // "フォルダ/サブフォルダ" 表示用
    passphrase: string; // FileBundle の復号鍵
  }
  ```
- 掲載対象: 削除されておらず、lastCid と解決可能な復号鍵を両方持つファイルのみ。
- 発行タイミング: スナップショット/フォルダ鍵の変化時 (debounce 可) + 起動時。
- `passphrase` は暗号化索引の内部にのみ格納する。公開 CID から平文のファイル鍵を
  取得できないようにし、索引鍵は同一オリジン localStorage の信頼境界内に留める。
- 後方互換: 旧 inline meta (`version: 1` / `files`) を優先して読む。
  暗号化 format のない CID は旧平文 `{version, updatedAt, files}` または裸配列として読む。
  暗号化 format がある場合は必ず復号し、鍵の欠落・不一致・不正なデータは空配列を返す。
  復号失敗から平文読取へはフォールバックしない。

## tc-travel 側実装 (`src/lib/drive/`)

旧 `src/lib/tcstorage/` を改名 (バンドル形式は中立契約)。
`crypto.ts` の読取は AES-GCM 256 / PBKDF2-SHA256 と HKDF-SHA256 に対応する。
PBKDF2 の iterations は整数の100000〜1000000 (両端含む)、HKDF は整数の0のみ。
HKDF は UTF-8 の鍵文字列、記録された salt、SHA-256、空の info で導出する。
両形式とも salt は16バイト、iv は12バイト、cipherText は空でない base64 データ。
暗号化出力は従来の PBKDF2-SHA256 / 210000 iterations を維持する。

- `export.ts`: `FOLDER_EXPORT_TOPIC = "folder-export"`。
  `exportPhotoToDrive(input)` / `isPhotoExported(photoId)`。
  状態キーは `tc-travel:driveExport` (旧 `tc-travel:tcStorageExport` からの
  読み取り移行必須: 新キーが無ければ旧キーを読み、次回 save で新キーに書いて
  旧キーを削除。既存ユーザーのフォルダ分裂防止)。
- `reader.ts`: `readShared("drive-index")` だけを読み、暗号化 CID は
  同一オリジンの meta.indexKey で復号してから索引を抽出する。
  `listDriveFiles({extensions?}): DriveFileEntry[]`
  (`{ entry: DriveIndexEntry }` 相当。索引不在→空配列) と
  `loadDriveFileBytes(entry): Promise<Uint8Array>`
  (lastCid → storage_get → envelope → decryptJson<FileBundle> → dataUrl → bytes)。
  `tc-storage-snapshot-v1` / `tc-storage-folder-keys-v1` への参照は完全削除。
- `mistNode.ts`: `tc-storage-did-identity-v1` の直読みを**廃止**。代替は共有
  ポインタ `tc-shared-did-identity-cid-v1` 経由の遅延採用: ノード初期化後に
  cid を storage_get → identity JSON の `.did` を検証して `tc-travel:nodeId` に
  保存 (= 次回セッションから family DID で参加)。失敗は無音フォールバック。
- UI 文言: 「TC Storage」→「ドライブ」系へ (album: ドライブに保存/保存済み/失敗、
  ar: ドライブから選ぶ 等)。8言語すべて更新。
- エクスポートするフォルダ名 "TC Travel" は出所を示す**データ**なので維持。

## ドライブ側 (tc-storage) 実装

- `travelImport.ts` → `folderImport.ts`: トピック `folder-export`、
  取込済み cid を `tc-storage-folder-import-cids-v1` (Record<folderId, cid>) で管理。
  旧 `tc-storage-travel-import-cid-v1` は初回に読み捨て移行して削除。
  activity action は `folder-import`。
- `useTravelImportEffect.ts` → `useFolderImportEffect.ts` (同配線)。
- **新規** `useDriveIndexPublishEffect` (または同等): snapshot / folderKeys の
  変化を購読し (既存の persistSnapshot effect と同じ場所)、掲載対象ファイルの
  v1 索引を構築して暗号化し、暗号化エンベロープだけを storage_add する。
  `publishShared("drive-index", encryptedCid, {format, indexKey, count, updatedAt})`
  で同一オリジンへ通知する。索引鍵・ファイル鍵は CID やネットワーク送信に含めない。
  1秒程度の debounce 可。パスは folderPath 利用。鍵解決は
  nearestSharedAncestorFolder と同じ規則 (自フォルダ鍵→祖先鍵)。
- 旧 `travel-export` トピックの購読は削除 (公開直後でユーザー実データなしのため
  後方互換レイヤーは設けない)。

## 共通ルール

- 新規 npm 依存禁止 / 新 UI 文言は 8言語 / 例外は握りつぶさない。
- どちらのアプリも相手の名前空間キーに setItem / getItem しないこと (grep で検証)。
- コミットはオーケストレーター (ユーザー承認後)。
