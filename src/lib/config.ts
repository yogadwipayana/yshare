import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export type ConflictPolicy = "rename" | "overwrite" | "skip";

export type Root = {
  id: string;
  name: string;
  /** Path as written in the config, resolved to absolute. */
  path: string;
  /** Canonical path on disk (symlinks/junctions resolved). Used for all safety checks. */
  realPath: string;
};

export type Config = {
  server: {
    host: string;
    port: number;
    lanOnly: boolean;
    allowedHosts: string[];
  };
  auth: {
    enabled: boolean;
    sessionTtlMs: number;
  };
  roots: Root[];
  upload: {
    maxFileSize: number;
    conflictDefault: ConflictPolicy;
    parallel: number;
    blockedExtensions: string[];
  };
};

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

export function parseSize(value: string | number): number {
  if (typeof value === "number") return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(value);
  if (!match) throw new Error(`Ukuran tidak valid: "${value}" (contoh: 500MB, 20GB)`);
  return Math.floor(Number(match[1]) * SIZE_UNITS[(match[2] ?? "b").toLowerCase()]);
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string | number): number {
  if (typeof value === "number") return value * 1000;
  const match = /^\s*(\d+)\s*(s|m|h|d)\s*$/i.exec(value);
  if (!match) throw new Error(`Durasi tidak valid: "${value}" (contoh: 30m, 12h, 7d)`);
  return Number(match[1]) * DURATION_UNITS[match[2].toLowerCase()];
}

const sizeSchema = z.union([z.string(), z.number().int().nonnegative()]);

const fileSchema = z.object({
  server: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().min(1).max(65535).default(8080),
      lan_only: z.boolean().default(true),
      allowed_hosts: z.array(z.string()).default([]),
    })
    .prefault({}),
  auth: z
    .object({
      enabled: z.boolean().default(true),
      session_ttl: z.union([z.string(), z.number()]).default("12h"),
    })
    .prefault({}),
  roots: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9_-]+$/i, "id root hanya boleh huruf, angka, - dan _"),
        name: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .min(1, "Minimal harus ada satu root folder"),
  upload: z
    .object({
      max_file_size: sizeSchema.default("20GB"),
      conflict_default: z.enum(["rename", "overwrite", "skip"]).default("rename"),
      parallel: z.number().int().min(1).max(10).default(3),
      blocked_extensions: z.array(z.string()).default([]),
    })
    .prefault({}),
});

export class ConfigError extends Error {}

export function defaultConfigPath(): string {
  return path.resolve(process.env.YSHARE_CONFIG ?? "yshare.config.yaml");
}

/**
 * Reads and validates the YAML config. Roots that don't exist are skipped with a warning
 * (returned in `warnings`) so one typo doesn't stop the whole server.
 */
export function loadConfig(configPath = defaultConfigPath()): { config: Config; warnings: string[] } {
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`File konfigurasi tidak ditemukan: ${configPath}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new ConfigError(`Format YAML tidak valid di ${configPath}: ${(err as Error).message}`);
  }

  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Konfigurasi tidak valid:\n${issues}`);
  }
  const data = parsed.data;
  const warnings: string[] = [];
  const baseDir = path.dirname(configPath);

  const seenIds = new Set<string>();
  const roots: Root[] = [];
  for (const root of data.roots) {
    if (seenIds.has(root.id)) throw new ConfigError(`id root dobel: "${root.id}"`);
    seenIds.add(root.id);

    const absolute = path.resolve(baseDir, root.path);
    let realPath: string;
    try {
      realPath = fs.realpathSync.native(absolute);
      if (!fs.statSync(realPath).isDirectory()) {
        warnings.push(`Root "${root.name}" bukan folder, dilewati: ${absolute}`);
        continue;
      }
    } catch {
      warnings.push(`Root "${root.name}" tidak ditemukan, dilewati: ${absolute}`);
      continue;
    }
    roots.push({ id: root.id, name: root.name, path: absolute, realPath });
  }

  if (roots.length === 0) {
    throw new ConfigError("Tidak ada root folder yang bisa dipakai. Periksa bagian `roots` di konfigurasi.");
  }

  let maxFileSize: number;
  let sessionTtlMs: number;
  try {
    maxFileSize = parseSize(data.upload.max_file_size);
    sessionTtlMs = parseDuration(data.auth.session_ttl);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }

  return {
    warnings,
    config: {
      server: {
        host: data.server.host,
        port: data.server.port,
        lanOnly: data.server.lan_only,
        allowedHosts: data.server.allowed_hosts.map((h) => h.toLowerCase()),
      },
      auth: { enabled: data.auth.enabled, sessionTtlMs },
      roots,
      upload: {
        maxFileSize,
        conflictDefault: data.upload.conflict_default,
        parallel: data.upload.parallel,
        blockedExtensions: data.upload.blocked_extensions.map((ext) =>
          (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase(),
        ),
      },
    },
  };
}
