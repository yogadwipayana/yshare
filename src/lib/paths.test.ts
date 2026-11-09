import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Root } from "./config";
import {
  isWithin,
  numberedName,
  PathError,
  resolveSafeDir,
  resolveSafeFile,
  sanitizeFileName,
  splitRelativePath,
  validateFolderName,
} from "./paths";

describe("splitRelativePath", () => {
  it("accepts normal relative paths", () => {
    expect(splitRelativePath("")).toEqual([]);
    expect(splitRelativePath("Foto/2026")).toEqual(["Foto", "2026"]);
    expect(splitRelativePath("Foto\\2026\\")).toEqual(["Foto", "2026"]);
    expect(splitRelativePath("/Foto//Liburan Bali/")).toEqual(["Foto", "Liburan Bali"]);
  });

  it.each([
    "..",
    "../Windows",
    "Foto/../../Windows",
    "Foto/./x",
    "C:",
    "C:/Windows",
    "C:\\Windows\\System32",
    "file.txt:stream",
    "Foto/CON",
    "Foto/nul.txt",
    "Foto/trailingdot.",
    "Foto/trailingspace ",
    "a\u0000b",
  ])("rejects %j", (input) => {
    expect(splitRelativePath(input)).toBeNull();
  });

  it("treats UNC-style prefixes as plain segments, never as a server", () => {
    // `\\server\share` collapses into segments that get joined under the root.
    expect(splitRelativePath("\\\\server\\share")).toEqual(["server", "share"]);
  });
});

describe("sanitizeFileName", () => {
  it("keeps normal names", () => {
    expect(sanitizeFileName("IMG_0001.JPG")).toBe("IMG_0001.JPG");
    expect(sanitizeFileName("Laporan Akhir (final).pdf")).toBe("Laporan Akhir (final).pdf");
    expect(sanitizeFileName(".env")).toBe(".env");
  });

  it("replaces characters Windows forbids", () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j.txt')).toBe("a_b_c_d_e_f_g_h_i_j.txt");
    expect(sanitizeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("strips trailing dots and spaces", () => {
    expect(sanitizeFileName("file.txt. . ")).toBe("file.txt");
    expect(sanitizeFileName("...")).toBeNull();
    expect(sanitizeFileName("   ")).toBeNull();
    expect(sanitizeFileName("")).toBeNull();
  });

  it("prefixes Windows device names", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFileName("com1.log")).toBe("_com1.log");
    expect(sanitizeFileName("console.txt")).toBe("console.txt");
  });

  it("never produces names that look like yshare temp files", () => {
    expect(sanitizeFileName(".yshare-abc.part")).toBe("_.yshare-abc.part");
  });

  it("truncates long names but keeps the extension", () => {
    const long = `${"a".repeat(300)}.jpg`;
    const result = sanitizeFileName(long)!;
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith(".jpg")).toBe(true);
    const multibyte = `${"文".repeat(150)}.txt`;
    expect(Buffer.byteLength(sanitizeFileName(multibyte)!, "utf8")).toBeLessThanOrEqual(240);
  });
});

describe("validateFolderName", () => {
  it("accepts normal names", () => {
    expect(validateFolderName("Liburan 2026")).toEqual({ ok: true, name: "Liburan 2026" });
  });

  it.each(["", "  ", ".", "..", "a/b", "a\\b", "a:b", "AUX", "folder.", "x?"])("rejects %j", (name) => {
    expect(validateFolderName(name).ok).toBe(false);
  });
});

describe("numberedName", () => {
  it("adds a counter before the extension", () => {
    expect(numberedName("foto.jpg", 0)).toBe("foto.jpg");
    expect(numberedName("foto.jpg", 1)).toBe("foto (1).jpg");
    expect(numberedName("README", 2)).toBe("README (2)");
    expect(numberedName(".bashrc", 1)).toBe(".bashrc (1)");
  });
});

describe("isWithin", () => {
  const base = path.resolve("/data/root");
  it("works for children and rejects siblings", () => {
    expect(isWithin(base, base)).toBe(true);
    expect(isWithin(base, path.join(base, "a", "b"))).toBe(true);
    expect(isWithin(base, path.join(base, "..folder"))).toBe(true);
    expect(isWithin(base, path.resolve("/data/root-other"))).toBe(false);
    expect(isWithin(base, path.resolve("/data"))).toBe(false);
  });
});

describe("resolveSafeDir", () => {
  let tmp: string;
  let outside: string;
  let root: Root;

  beforeAll(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "yshare-test-")));
    const rootDir = path.join(tmp, "root");
    outside = path.join(tmp, "outside");
    fs.mkdirSync(path.join(rootDir, "Foto", "2026"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(rootDir, "file.txt"), "x");
    // A junction (Windows) / symlink (elsewhere) inside the root that points outside it.
    fs.symlinkSync(outside, path.join(rootDir, "escape"), "junction");
    root = { id: "t", name: "Test", path: rootDir, realPath: rootDir };
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves folders inside the root", async () => {
    await expect(resolveSafeDir(root, "")).resolves.toBe(root.realPath);
    await expect(resolveSafeDir(root, "Foto/2026")).resolves.toBe(path.join(root.realPath, "Foto", "2026"));
  });

  it("rejects traversal", async () => {
    await expect(resolveSafeDir(root, "../outside")).rejects.toBeInstanceOf(PathError);
    await expect(resolveSafeDir(root, "Foto/../../outside")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects absolute paths and drive letters", async () => {
    await expect(resolveSafeDir(root, outside)).rejects.toBeInstanceOf(PathError);
    await expect(resolveSafeDir(root, "C:\\Windows")).rejects.toBeInstanceOf(PathError);
  });

  it("rejects links that point outside the root", async () => {
    await expect(resolveSafeDir(root, "escape")).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for missing folders and 400 for files", async () => {
    await expect(resolveSafeDir(root, "Tidak Ada")).rejects.toMatchObject({ status: 404 });
    await expect(resolveSafeDir(root, "file.txt")).rejects.toMatchObject({ status: 400 });
  });
});

describe("resolveSafeFile", () => {
  let tmp: string;
  let root: Root;

  beforeAll(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "yshare-test-")));
    const rootDir = path.join(tmp, "root");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(path.join(rootDir, "Foto"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(rootDir, "Foto", "IMG_001.jpg"), "jpeg");
    fs.writeFileSync(path.join(rootDir, "Foto", ".yshare-abc.part"), "partial");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(rootDir, "escape"), "junction");
    root = { id: "t", name: "Test", path: rootDir, realPath: rootDir };
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns files inside the root", async () => {
    const file = await resolveSafeFile(root, "Foto", "IMG_001.jpg");
    expect(file.path).toBe(path.join(root.realPath, "Foto", "IMG_001.jpg"));
    expect(file.size).toBe(4);
  });

  it.each(["../escape/secret.txt", "..", "a/b.jpg", "a\\b.jpg", "C:\\x.jpg", "", ".hidden", ".yshare-abc.part", "x.jpg:stream"])(
    "rejects the name %j",
    async (name) => {
      await expect(resolveSafeFile(root, "Foto", name)).rejects.toMatchObject({ status: 400 });
    },
  );

  it("rejects files reached through a link that leaves the root", async () => {
    await expect(resolveSafeFile(root, "escape", "secret.txt")).rejects.toMatchObject({ status: 403 });
    await expect(resolveSafeFile(root, "../outside", "secret.txt")).rejects.toBeInstanceOf(PathError);
  });

  it("returns 404 for missing files and folders", async () => {
    await expect(resolveSafeFile(root, "Foto", "tidak-ada.jpg")).rejects.toMatchObject({ status: 404 });
    await expect(resolveSafeFile(root, "", "Foto")).rejects.toMatchObject({ status: 404 });
  });
});
