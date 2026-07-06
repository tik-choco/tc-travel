// Shapes for the neutral encrypted-bundle contract (see
// protocol/docs/data-contracts/docs/encrypted-bundle.md and
// docs/INTEGRATION.md). Byte/shape compatibility matters here, not source
// formatting, since a drive-implementing app must be able to decrypt what
// tc-travel writes into an encrypted FileBundle/FolderBundle for mist
// storage (export.ts). tc-travel never reads or mutates a drive app's own
// workspace state directly — see reader.ts, which only reads the
// `drive-index` shared-bus topic.
export type VersionStamp = {
  updatedAt: string;
  nodeId: string;
};

export type FolderColor = "teal" | "blue" | "amber" | "rose" | "slate";

export type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder?: number;
  color: FolderColor;
  encrypted: boolean;
  shareEnabled: boolean;
  sharedRoomId: string;
  lastCid?: string;
  lastSavedAt?: string;
  lastSharedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  fieldVersions?: Record<string, VersionStamp>;
};

export type FileRecord = {
  id: string;
  folderId: string;
  sortOrder?: number;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  checksum: string;
  version: number;
  starred: boolean;
  lastCid?: string;
  lastShareCid?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  fieldVersions?: Record<string, VersionStamp>;
};

export type StorageSnapshot = {
  folders: FolderRecord[];
  files: FileRecord[];
  activity: unknown[];
  clock: number;
  originNode: string;
};

export type FolderBundle = {
  version: 1;
  exportedAt: string;
  originNode: string;
  folder: FolderRecord;
  folders?: FolderRecord[];
  files: FileRecord[];
};

export type FileBundle = {
  version: 1;
  exportedAt: string;
  originNode: string;
  folder: FolderRecord;
  file: FileRecord;
};
