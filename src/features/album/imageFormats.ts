export const RAW_IMAGE_EXTENSIONS = [
  "3fr",
  "ari",
  "arw",
  "bay",
  "cap",
  "cr2",
  "cr3",
  "crw",
  "dcr",
  "dng",
  "eip",
  "erf",
  "fff",
  "iiq",
  "kdc",
  "mdc",
  "mef",
  "mos",
  "mrw",
  "nef",
  "nrw",
  "orf",
  "pef",
  "ptx",
  "pxn",
  "raf",
  "r3d",
  "raw",
  "rw2",
  "rwl",
  "rwz",
  "sr2",
  "srf",
  "srw",
  "x3f",
] as const;

export const ALBUM_IMAGE_EXTENSIONS = [
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
  ...RAW_IMAGE_EXTENSIONS,
] as const;

const RAW_IMAGE_EXTENSION_SET = new Set<string>(RAW_IMAGE_EXTENSIONS);
const ALBUM_IMAGE_EXTENSION_SET = new Set<string>(ALBUM_IMAGE_EXTENSIONS);

export function isRawImageExtension(extension: string | null | undefined): boolean {
  return RAW_IMAGE_EXTENSION_SET.has(extension?.toLowerCase() ?? "");
}

export function isAlbumImageExtension(extension: string | null | undefined): boolean {
  return ALBUM_IMAGE_EXTENSION_SET.has(extension?.toLowerCase() ?? "");
}
