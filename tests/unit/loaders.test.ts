import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveAssetUrl, resolveManifestUrl } from '../../src/core/AssetResolver';
import { CatalogRepository, compareVersions } from '../../src/core/CatalogRepository';
import { WordpackRepository } from '../../src/core/WordpackRepository';
import { VisibleContentError } from '../../src/core/errors';
import { fakeFetch, makePack } from './helpers';

// ---- 상대 asset URL 해석 (본문서 §12.1) ----

test('상대 asset URL은 manifest URL 기준으로 해석된다', () => {
  const m = 'https://cdn.example/packs/w/1.0.0/pack.json';
  assert.equal(resolveAssetUrl(m, 'scene/master.svg'), 'https://cdn.example/packs/w/1.0.0/scene/master.svg');
  assert.equal(resolveAssetUrl(m, 'audio/full.aac'), 'https://cdn.example/packs/w/1.0.0/audio/full.aac');
});

test('절대 URL·경로 탈출 자산 경로는 거부된다', () => {
  const m = 'https://cdn.example/packs/w/1.0.0/pack.json';
  assert.throws(() => resolveAssetUrl(m, 'https://evil.example/x'));
  assert.throws(() => resolveAssetUrl(m, '../../../etc/passwd'));
  assert.throws(() => resolveAssetUrl(m, '/abs'));
  assert.throws(() => resolveManifestUrl('https://cdn.example/catalog.json', '../up/pack.json'));
});

test('catalog URL을 CDN origin으로 바꿔도 같은 상대 구조가 동작한다 (§12.3)', () => {
  for (const origin of ['https://site-a.netlify.app', 'https://cdn.example.com/linkling']) {
    const manifestUrl = resolveManifestUrl(`${origin}/catalog.json`, 'packs/w/1.0.0/pack.json');
    assert.equal(manifestUrl, `${origin}/packs/w/1.0.0/pack.json`);
    assert.equal(resolveAssetUrl(manifestUrl, 'scene/master.svg'), `${origin}/packs/w/1.0.0/scene/master.svg`);
  }
});

// ---- catalog parse·schema version 차단 (본문서 §12.1) ----

const goodCatalog = {
  schema_version: '1.0.0',
  catalog_version: 'test-1',
  generated_at: '2026-07-20T00:00:00Z',
  packs: [{ word_id: 'w', word: 'w', wordpack_version: '1.0.0', status: 'preview', manifest_path: 'packs/w/1.0.0/pack.json' }],
};

test('정상 catalog 로드·last-good 저장', async () => {
  const kv = new Map<string, string>();
  const repo = new CatalogRepository('https://packs.test/catalog.json',
    fakeFetch({ 'https://packs.test/catalog.json': { json: goodCatalog } }),
    { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) });
  const { catalog, fromCache } = await repo.load();
  assert.equal(catalog.catalog_version, 'test-1');
  assert.equal(fromCache, false);
  assert.equal(kv.size, 1);
});

test('지원 밖 catalog schema는 명시적 오류 — 조용한 fallback 없음', async () => {
  const repo = new CatalogRepository('https://packs.test/catalog.json',
    fakeFetch({ 'https://packs.test/catalog.json': { json: { ...goodCatalog, schema_version: '9.0.0' } } }),
    { get: () => null, set: () => void 0 });
  await assert.rejects(() => repo.load(), (e: unknown) => e instanceof VisibleContentError);
});

test('원격 실패 시 마지막 정상 catalog 사용 (fromCache 표시)', async () => {
  const kv = new Map<string, string>([['linkling.catalog.lastGood.v1', JSON.stringify(goodCatalog)]]);
  const repo = new CatalogRepository('https://packs.test/catalog.json',
    fakeFetch({}), // 404
    { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) });
  const { fromCache, catalog } = await repo.load();
  assert.equal(fromCache, true);
  assert.equal(catalog.catalog_version, 'test-1');
});

test('minimum_app_version 미달 시 업데이트 안내 오류', async () => {
  const repo = new CatalogRepository('https://packs.test/catalog.json',
    fakeFetch({ 'https://packs.test/catalog.json': { json: { ...goodCatalog, minimum_app_version: '99.0.0' } } }),
    { get: () => null, set: () => void 0 });
  await assert.rejects(() => repo.load(), (e: unknown) => e instanceof VisibleContentError && /업데이트/.test((e as VisibleContentError).userMessageKo));
});

test('compareVersions', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.ok(compareVersions('0.1.0', '0.2.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
});

// ---- WordpackRepository: 지원 범위 밖 팩 로드 거부·무결성 (§12.1 + 부속 §4) ----

function repoRoutes(pack = makePack('w1', 'testword', 3), overrides: Record<string, unknown> = {}) {
  const runtimeJson = JSON.stringify(pack.wordpack);
  const bytes = new TextEncoder().encode(runtimeJson);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    ...pack.manifest,
    files: [{ path: 'wordpack.runtime.json', bytes: bytes.length, sha256: sha }],
    ...overrides,
  };
  return {
    entry: pack.entry,
    routes: {
      [`https://packs.test/packs/${pack.entry.word_id}/0.1.0/pack.json`]: { json: manifest },
      [`https://packs.test/packs/${pack.entry.word_id}/0.1.0/wordpack.runtime.json`]: { text: runtimeJson },
    },
  };
}

test('정상 팩 로드 + 해시·크기 검증 통과', async () => {
  const { entry, routes } = repoRoutes();
  const repo = new WordpackRepository('https://packs.test/catalog.json', fakeFetch(routes));
  const loaded = await repo.load(entry);
  assert.equal(loaded.wordpack.word, 'testword');
  assert.equal(loaded.manifest.scene.state_machine, 'LinklingWordpackSM');
});

test('지원 범위 밖 pack schema → 로드 거부 (조용한 구형 fallback 경로 없음)', async () => {
  const { entry, routes } = repoRoutes(makePack('w1', 'testword', 3), { schema_version: '2.0.0' });
  const repo = new WordpackRepository('https://packs.test/catalog.json', fakeFetch(routes));
  await assert.rejects(() => repo.load(entry), (e: unknown) =>
    e instanceof VisibleContentError && /지원하지 않는 형식/.test((e as VisibleContentError).userMessageKo));
});

test('무결성 훼손(크기 불일치) → 팩 격리 오류', async () => {
  const pack = makePack('w1', 'testword', 3);
  const { entry, routes } = repoRoutes(pack, {
    files: [{ path: 'wordpack.runtime.json', bytes: 1, sha256: 'f'.repeat(64) }],
  });
  const repo = new WordpackRepository('https://packs.test/catalog.json', fakeFetch(routes));
  await assert.rejects(() => repo.load(entry), (e: unknown) => e instanceof VisibleContentError);
});

test('authoring 필드(authoring_research/qa)가 남아 있으면 거부 (§8.5)', async () => {
  const pack = makePack('w1', 'testword', 3);
  (pack.wordpack as unknown as Record<string, unknown>).qa = { some: 'data' };
  const { entry, routes } = repoRoutes(pack);
  const repo = new WordpackRepository('https://packs.test/catalog.json', fakeFetch(routes));
  await assert.rejects(() => repo.load(entry), (e: unknown) => e instanceof VisibleContentError);
});
