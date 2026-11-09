import { describe, expect, it } from "vitest";
import { canThumbnail, mediaInfo } from "./media";
import { contentDisposition, fileVersion, parseRange } from "./serve";

describe("parseRange", () => {
  it("sends the whole file without a usable header", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 100)).toBeNull(); // multiple ranges
    expect(parseRange("items=0-5", 100)).toBeNull();
  });

  it("parses single ranges", () => {
    expect(parseRange("bytes=0-99", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects ranges outside the file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=50-10", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("bytes=0-", 0)).toBe("invalid");
  });
});

describe("contentDisposition", () => {
  it("keeps the real name and an ASCII fallback", () => {
    expect(contentDisposition("inline", "foto.jpg")).toBe(`inline; filename="foto.jpg"; filename*=UTF-8''foto.jpg`);
    expect(contentDisposition("attachment", 'liburan "bali" 🌴.jpg')).toBe(
      `attachment; filename="liburan _bali_ __.jpg"; filename*=UTF-8''liburan%20%22bali%22%20%F0%9F%8C%B4.jpg`,
    );
  });

  it("can't break out of the header value", () => {
    const value = contentDisposition("inline", "a\r\nSet-Cookie: x=1;.jpg");
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith("inline; ")).toBe(true);
  });
});

describe("mediaInfo", () => {
  it("shows media inline and everything else as a download", () => {
    expect(mediaInfo("IMG_001.JPG")).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(mediaInfo("klip.mov").kind).toBe("video");
    expect(mediaInfo("lagu.mp3").kind).toBe("audio");
    expect(mediaInfo("halaman.html")).toEqual({ kind: "other", mime: "application/octet-stream" });
    expect(mediaInfo("logo.svg").kind).toBe("other"); // SVG can contain scripts
    expect(mediaInfo("README").kind).toBe("other");
    expect(mediaInfo(".jpg").kind).toBe("other");
  });

  it("knows which images get a thumbnail", () => {
    expect(canThumbnail("a.jpeg")).toBe(true);
    expect(canThumbnail("a.heic")).toBe(false);
  });
});

describe("fileVersion", () => {
  it("changes when size or modification time changes", () => {
    const base = fileVersion({ size: 10, modified: 1_700_000_000_000.5 });
    expect(fileVersion({ size: 11, modified: 1_700_000_000_000.5 })).not.toBe(base);
    expect(fileVersion({ size: 10, modified: 1_700_000_000_001 })).not.toBe(base);
  });
});
