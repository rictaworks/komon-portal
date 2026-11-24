/** File name without any directory part. Both separators are handled because folders can be uploaded from any OS. */
export function baseName(fileName: string): string {
  const parts = fileName.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** Lower-cased extension without the dot, or an empty string. */
export function extensionOf(fileName: string): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Base name without its extension. */
export function stemOf(fileName: string): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}
