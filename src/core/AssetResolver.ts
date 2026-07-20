/**
 * 팩 내부 상대 경로를 pack manifest URL 기준 절대 URL로 해석한다 (본문서 §8.2).
 * 절대 URL·경로 탈출은 거부한다 — 팩 자산은 반드시 manifest 기준 상대 경로.
 */
export function resolveAssetUrl(manifestUrl: string, relPath: string): string {
  if (!relPath || /^[a-z]+:/i.test(relPath) || relPath.startsWith('/') || relPath.includes('..')) {
    throw new Error(`허용되지 않는 자산 경로: "${relPath}"`);
  }
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return new URL(relPath, base).toString();
}

/** catalog URL 기준으로 manifest_path를 해석한다 */
export function resolveManifestUrl(catalogUrl: string, manifestPath: string): string {
  if (!manifestPath || manifestPath.includes('..') || /^[a-z]+:/i.test(manifestPath)) {
    throw new Error(`허용되지 않는 manifest 경로: "${manifestPath}"`);
  }
  const base = catalogUrl.slice(0, catalogUrl.lastIndexOf('/') + 1);
  return new URL(manifestPath, base).toString();
}
