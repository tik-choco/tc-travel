// Verbatim port of the record shapes tc-storage persists (tc-storage's
// src/storage/domain.ts). Byte/shape compatibility matters here, not source
// formatting — see docs/INTEGRATION.md. tc-travel only ever reads these back
// out of `tc-storage-snapshot-v1` (reader.ts) or writes them into an
// encrypted FileBundle/FolderBundle for mist storage (export.ts); it never
// mutates a live tc-storage workspace directly.
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
