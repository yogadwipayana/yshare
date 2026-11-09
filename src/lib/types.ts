// Shapes of the JSON exchanged between the API routes and the browser.

export type ConflictPolicy = "rename" | "overwrite" | "skip";

export type DiskSpace = { free: number; total: number } | null;

export type SessionInfo = {
  authenticated: boolean;
  authEnabled: boolean;
  settings?: UploadSettings;
};

export type UploadSettings = {
  maxFileSize: number;
  parallel: number;
  conflictDefault: ConflictPolicy;
  blockedExtensions: string[];
};

export type RootInfo = { id: string; name: string; space: DiskSpace };

export type FolderListing = {
  root: { id: string; name: string };
  path: string;
  segments: string[];
  folders: { name: string }[];
  files: { name: string; size: number; modified: number }[];
  fileCount: number;
  space: DiskSpace;
};

export type CreateUploadResponse =
  | { status: "created" | "resume"; id: string; offset: number }
  | { status: "skipped"; name: string };

export type PatchUploadResponse =
  | { status: "saved"; name: string; size: number; renamed: boolean }
  | { status: "partial"; offset: number };
