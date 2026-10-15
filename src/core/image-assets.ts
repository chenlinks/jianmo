const previews = new Map<string, string>();
export const localImageName = (source: string) => /^(?:(?:\.\/)?\.assets\/|jianmo-asset:\/\/)([a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp))$/i.exec(source)?.[1];
export function imagePreview(source: string, context = '') { return previews.get(`${context}\0${source}`); }
export function cacheImagePreview(source: string, url: string, context = '') {
  const key = `${context}\0${source}`; const previous = previews.get(key);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  previews.set(key, url);
}
