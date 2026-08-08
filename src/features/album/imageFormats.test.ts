import { describe, expect, it } from "vitest";

import { ALBUM_IMAGE_EXTENSIONS, isAlbumImageExtension, isRawImageExtension } from "./imageFormats";

describe("album image formats", () => {
  it("includes common camera RAW formats", () => {
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("cr3");
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("nef");
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("arw");
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("dng");
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("x3f");
    expect(ALBUM_IMAGE_EXTENSIONS).toContain("iiq");
  });

  it("matches extensions case-insensitively", () => {
    expect(isRawImageExtension("CR2")).toBe(true);
    expect(isAlbumImageExtension("RAF")).toBe(true);
    expect(isRawImageExtension("jpg")).toBe(false);
  });
});
