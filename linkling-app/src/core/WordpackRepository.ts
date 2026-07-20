import type { CatalogPackEntry, LoadedPack, PackManifest, RuntimeWordpack } from './types';
import { CONFIG } from './config';
import { VisibleContentError } from './errors';
import { resolveAssetUrl, resolveManifestUrl } from './AssetResolver';

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* insecure context 등 — 해시 검증은 가능한 환경에서만 */ }
  return null;
}

export class WordpackRepository {
  constructor(
    private readonly catalogUrl: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  /**
   * 개별 팩 로드: manifest → schema 범위 확인 → runtime wordpack → 무결성 검증.
   * 실패한 팩은 격리하고 명확한 오류를 던진다 (다른 팩 로드는 계속 가능).
   */
  async load(entry: CatalogPackEntry): Promise<LoadedPack> {
    const manifestUrl = resolveManifestUrl(this.catalogUrl, entry.manifest_path);
    const manifest = await this.loadManifest(manifestUrl, entry);

    const wordpackUrl = resolveAssetUrl(manifestUrl, manifest.wordpack_path);
    const res = await this.fetchFn(wordpackUrl);
    if (!res.ok) {
      throw new VisibleContentError('pack', `"${entry.word}" 단어팩을 내려받지 못했습니다.`, `HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();

    // 해시·크기 검증 (본문서 §7.2, 부속 명세 §4)
    const fileMeta = manifest.files?.find((f) => f.path === manifest.wordpack_path);
    if (fileMeta) {
      if (buf.byteLength !== fileMeta.bytes) {
        throw new VisibleContentError('pack', `"${entry.word}" 단어팩이 손상되었습니다 (크기 불일치).`);
      }
      const hash = await sha256Hex(buf);
      if (hash && hash !== fileMeta.sha256) {
        throw new VisibleContentError('pack', `"${entry.word}" 단어팩이 손상되었습니다 (무결성 검증 실패).`);
      }
    }

    const wordpack = JSON.parse(new TextDecoder().decode(buf)) as RuntimeWordpack;
    this.validateWordpack(wordpack, entry);

    return {
      entry,
      manifest,
      manifestUrl,
      wordpack,
      assetUrl: (rel: string) => resolveAssetUrl(manifestUrl, rel),
    };
  }

  private async loadManifest(manifestUrl: string, entry: CatalogPackEntry): Promise<PackManifest> {
    const res = await this.fetchFn(manifestUrl);
    if (!res.ok) {
      throw new VisibleContentError('pack', `"${entry.word}" 팩 정보를 내려받지 못했습니다.`, `HTTP ${res.status}`);
    }
    const manifest = (await res.json()) as PackManifest;
    if (!CONFIG.SUPPORTED_PACK_SCHEMA.includes(manifest.schema_version as never)) {
      // 조용한 fallback 금지 — 지원 불가 팩은 로드 자체를 거부한다 (부속 명세 §4)
      throw new VisibleContentError(
        'pack',
        `"${entry.word}" 팩은 이 앱 버전이 지원하지 않는 형식입니다 (schema ${manifest.schema_version}).`,
      );
    }
    if (manifest.word_id !== entry.word_id || manifest.wordpack_version !== entry.wordpack_version) {
      throw new VisibleContentError('pack', `"${entry.word}" 팩 정보가 목록과 일치하지 않습니다.`);
    }
    if (manifest.scene.state_machine !== 'LinklingWordpackSM') {
      throw new VisibleContentError('pack', `"${entry.word}" 팩의 장면 계약이 올바르지 않습니다.`);
    }
    return manifest;
  }

  private validateWordpack(wp: RuntimeWordpack, entry: CatalogPackEntry): void {
    if (!CONFIG.SUPPORTED_WORDPACK_SCHEMA.includes(wp.schema_version as never)) {
      throw new VisibleContentError(
        'pack',
        `"${entry.word}" 단어팩은 이 앱 버전이 지원하지 않는 형식입니다 (schema ${wp.schema_version}).`,
      );
    }
    // authoring 필드가 학생 앱으로 오면 안 된다 (본문서 §8.5)
    for (const banned of ['authoring_research', 'qa'] as const) {
      if (banned in (wp as unknown as Record<string, unknown>)) {
        throw new VisibleContentError('pack', `"${entry.word}" 팩에 배포 금지 데이터가 포함되어 있습니다.`, banned);
      }
    }
    const chunks = wp.pronunciation?.chunks ?? [];
    const layers = wp.scene?.layers ?? [];
    if (chunks.length < 2 || chunks.length > 4 || chunks.length !== layers.length) {
      throw new VisibleContentError('pack', `"${entry.word}" 팩의 Chunk/층 구성이 올바르지 않습니다.`);
    }
    chunks.forEach((c, i) => {
      if (c.order !== i + 1) throw new VisibleContentError('pack', `"${entry.word}" 팩 Chunk 순서 오류.`);
    });
    if (!chunks[chunks.length - 1].is_full_word) {
      throw new VisibleContentError('pack', `"${entry.word}" 팩의 마지막 Chunk가 전체 단어가 아닙니다.`);
    }
  }
}
