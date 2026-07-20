/**
 * 실행 설정 — 단어팩 도메인은 소스에 하드코딩하지 않는다 (본문서 §8.2).
 * 우선순위: 빌드 환경 변수(VITE_WORDPACK_CATALOG_URL) → URL ?catalog= (개발·preview 점검용)
 */
export function getCatalogUrl(): string | null {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WORDPACK_CATALOG_URL;
  if (fromEnv) return fromEnv;
  if (typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search).get('catalog');
    if (p) return p;
  }
  return null;
}

export function isResearchExportEnabled(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_RESEARCH_EXPORT === 'true';
}
