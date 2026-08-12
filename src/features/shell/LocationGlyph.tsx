import {
  Download,
  FileText,
  Folder,
  HardDrive,
  House,
  Images,
  Monitor,
  Music2,
  Star,
  Video,
  type LucideIcon,
} from "lucide-react";

export type LocationGlyphKind =
  | "this-pc"
  | "drive"
  | "profile"
  | "desktop"
  | "documents"
  | "downloads"
  | "pictures"
  | "music"
  | "videos"
  | "favorite"
  | "folder";

const LOCATION_GLYPHS: Record<LocationGlyphKind, LucideIcon> = {
  "this-pc": Monitor,
  drive: HardDrive,
  profile: House,
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  pictures: Images,
  music: Music2,
  videos: Video,
  favorite: Star,
  folder: Folder,
};

export function LocationGlyph({ kind, size = 15 }: { kind: LocationGlyphKind; size?: number }) {
  const Icon = LOCATION_GLYPHS[kind];
  return <Icon className={`location-glyph is-${kind}`} size={size} aria-hidden="true" />;
}
