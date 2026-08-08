export function displayPath(path: string): string {
  const trimmed = path.trim();
  if (/^\\\\\?\\UNC\\/i.test(trimmed)) {
    return `\\\\${trimmed.slice(8)}`;
  }
  if (/^\\\\\?\\/i.test(trimmed)) {
    return trimmed.slice(4);
  }
  if (/^\\\?\?\\UNC\\/i.test(trimmed)) {
    return `\\\\${trimmed.slice(8)}`;
  }
  if (/^\\\?\?\\/i.test(trimmed)) {
    return trimmed.slice(4);
  }
  return trimmed;
}

export function sameWindowsPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    let normalized = displayPath(value.trim()).replaceAll("/", "\\");
    while (normalized.length > 3 && normalized.endsWith("\\")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.toLocaleLowerCase("en-US");
  };

  return normalize(left) === normalize(right);
}
