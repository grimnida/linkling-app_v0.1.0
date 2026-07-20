import type { Catalog } from './types';
import { CONFIG } from './config';
import { VisibleContentError } from './errors';

const LAST_GOOD_KEY = 'linkling.catalog.lastGood.v1';

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class CatalogRepository {
  constructor(
    private readonly catalogUrl: string,
    // fetch를 그대로 필드에 담으면 브라우저에서 this 바인딩 오류(Illegal invocation)
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly kv: KeyValueStore = defaultKv(),
  ) {
    if (!catalogUrl) {
      throw new VisibleContentError('catalog', '단어팩 목록 주소가 설정되지 않았습니다. 관리자에게 문의해 주세요.', 'VITE_WORDPACK_CATALOG_URL 미설정');
    }
  }

  get url(): string { return this.catalogUrl; }

  /** 원격 catalog 로드. 실패 시 마지막 정상 catalog 사용(그 사실을 표시). */
  async load(): Promise<{ catalog: Catalog; fromCache: boolean }> {
    try {
      const res = await this.fetchFn(this.catalogUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const catalog = this.validate(await res.json());
      this.kv.set(LAST_GOOD_KEY, JSON.stringify(catalog));
      return { catalog, fromCache: false };
    } catch (e) {
      if (e instanceof VisibleContentError) throw e; // schema 문제는 캐시로 덮지 않는다
      const cached = this.kv.get(LAST_GOOD_KEY);
      if (cached) {
        return { catalog: this.validate(JSON.parse(cached)), fromCache: true };
      }
      throw new VisibleContentError('catalog', '단어팩 목록을 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.', String(e));
    }
  }

  /** schema/version 확인 — 지원 범위 밖이면 명시적 오류 (조용한 fallback 금지) */
  validate(raw: unknown): Catalog {
    const c = raw as Catalog;
    if (!c || typeof c !== 'object' || !Array.isArray(c.packs)) {
      throw new VisibleContentError('catalog', '단어팩 목록 형식이 올바르지 않습니다.');
    }
    if (!CONFIG.SUPPORTED_CATALOG_SCHEMA.includes(c.schema_version as never)) {
      throw new VisibleContentError(
        'catalog',
        `이 앱 버전이 지원하지 않는 콘텐츠 형식입니다 (catalog schema ${c.schema_version}). 앱을 업데이트해 주세요.`,
      );
    }
    if (c.minimum_app_version && compareVersions(CONFIG.APP_VERSION, c.minimum_app_version) < 0) {
      throw new VisibleContentError(
        'catalog',
        `앱 업데이트가 필요합니다 (필요 버전 ${c.minimum_app_version}, 현재 ${CONFIG.APP_VERSION}).`,
      );
    }
    for (const p of c.packs) {
      if (!p.word_id || !p.manifest_path || !p.wordpack_version) {
        throw new VisibleContentError('catalog', '단어팩 목록 항목이 손상되었습니다.', p.word_id ?? '(unknown)');
      }
    }
    return c;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function defaultKv(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
      };
    }
  } catch { /* private mode 등 */ }
  const mem = new Map<string, string>();
  return { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) };
}
