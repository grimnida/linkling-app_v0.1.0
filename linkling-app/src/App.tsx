import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, CatalogPackEntry, LoadedPack } from './core/types';
import { CatalogRepository } from './core/CatalogRepository';
import { WordpackRepository } from './core/WordpackRepository';
import { WordpackCache } from './core/WordpackCache';
import { LearningSessionEngine } from './core/LearningSessionEngine';
import { ReviewSessionEngine } from './core/ReviewSessionEngine';
import { TelemetryLogger } from './core/TelemetryLogger';
import { ProgressStore } from './core/ProgressStore';
import { AudioController } from './core/AudioController';
import { ManualTypingEvaluator, MockPronunciationEvaluator } from './core/PronunciationEvaluator';
import { VisibleContentError } from './core/errors';
import { getCatalogUrl } from './env';
import { LearnScreen } from './ui/LearnScreen';
import { ReviewScreen } from './ui/ReviewScreen';
import { SummaryScreen } from './ui/SummaryScreen';
import { CONFIG } from './core/config';

type AppScreen =
  | { name: 'BOOT' }
  | { name: 'CATALOG_LOADING'; detail?: string }
  | { name: 'HOME'; catalog: Catalog; fromCache: boolean; packErrors: string[]; cached: { wordId: string; version: string }[] }
  | { name: 'PACK_PREFETCH'; loaded: number; total: number }
  | { name: 'LEARN'; packs: LoadedPack[] }
  | { name: 'REVIEW'; packs: LoadedPack[] }
  | { name: 'SUMMARY' }
  | { name: 'ERROR_RECOVERY'; messageKo: string; retry: () => void };

export function App(): React.ReactElement {
  const [screen, setScreen] = useState<AppScreen>({ name: 'BOOT' });
  const [packErrors, setPackErrors] = useState<string[]>([]);

  const services = useMemo(() => {
    const telemetry = new TelemetryLogger();
    const progress = new ProgressStore();
    const audio = new AudioController();
    const evaluators = {
      // 실제 발음 provider는 [확인 필요] — 개발·E2E는 Mock/Manual (본문서 §7.6)
      speech: new MockPronunciationEvaluator(),
      text: new ManualTypingEvaluator(),
    };
    const engine = new LearningSessionEngine(telemetry, progress, evaluators);
    const review = new ReviewSessionEngine(telemetry, progress, evaluators);
    const cache = new WordpackCache();
    return { telemetry, progress, audio, evaluators, engine, review, cache };
  }, []);

  const loadedPacksRef = useRef<LoadedPack[]>([]);

  const boot = useCallback(async () => {
    const catalogUrl = getCatalogUrl();
    setScreen({ name: 'CATALOG_LOADING' });
    try {
      const catalogRepo = new CatalogRepository(catalogUrl ?? '');
      const { catalog, fromCache } = await catalogRepo.load();
      const cached = await services.cache.listStored();
      setScreen({ name: 'HOME', catalog, fromCache, packErrors: [], cached });
    } catch (e) {
      const msg = e instanceof VisibleContentError ? e.userMessageKo : '시작 중 문제가 생겼습니다. 다시 시도해 주세요.';
      setScreen({ name: 'ERROR_RECOVERY', messageKo: msg, retry: () => void boot() });
    }
  }, [services]);

  useEffect(() => { void boot(); }, [boot]);

  /** 팩 로드 — 실패한 팩은 격리하고 나머지는 계속 (조용한 fallback 없음, 오류는 화면 표시) */
  const loadPacks = useCallback(async (catalog: Catalog, entries: CatalogPackEntry[]): Promise<LoadedPack[]> => {
    const catalogUrl = getCatalogUrl()!;
    const repo = new WordpackRepository(catalogUrl);
    const errors: string[] = [];
    const packs: LoadedPack[] = [];
    let done = 0;
    setScreen({ name: 'PACK_PREFETCH', loaded: 0, total: entries.length });
    for (const entry of entries) {
      try {
        const pack = await repo.load(entry);
        packs.push(pack);
        await services.cache.storePack(pack);
        // 자산 선행 로드 (SVG fallback + 오디오는 있으면)
        const urls: string[] = [];
        if (pack.manifest.scene.fallback_svg_path) urls.push(pack.assetUrl(pack.manifest.scene.fallback_svg_path));
        if (pack.manifest.scene.availability === 'ready' && pack.manifest.scene.riv_path) {
          urls.push(pack.assetUrl(pack.manifest.scene.riv_path));
        }
        await services.cache.prefetchAssets(urls);
      } catch (e) {
        const msg = e instanceof VisibleContentError ? e.userMessageKo : `"${entry.word}" 팩 로드 실패`;
        errors.push(msg);
      }
      done++;
      setScreen({ name: 'PACK_PREFETCH', loaded: done, total: entries.length });
    }
    setPackErrors(errors);
    return packs;
  }, [services]);

  const startLearning = useCallback(async (catalog: Catalog, selected: CatalogPackEntry[]) => {
    await services.audio.unlock(); // 사용자 제스처 안에서 언락
    const packs = await loadPacks(catalog, selected);
    if (packs.length === 0) {
      setScreen({
        name: 'ERROR_RECOVERY',
        messageKo: '학습할 수 있는 단어팩이 없습니다. 네트워크 상태를 확인해 주세요.',
        retry: () => void boot(),
      });
      return;
    }
    loadedPacksRef.current = packs;
    services.engine.startSession(packs);
    setScreen({ name: 'LEARN', packs });
  }, [services, loadPacks, boot]);

  const startReview = useCallback(async (catalog: Catalog, dueEntries: CatalogPackEntry[]) => {
    await services.audio.unlock();
    const packs = await loadPacks(catalog, dueEntries);
    if (packs.length === 0) {
      setScreen({ name: 'ERROR_RECOVERY', messageKo: '복습할 단어팩을 불러오지 못했습니다.', retry: () => void boot() });
      return;
    }
    loadedPacksRef.current = packs;
    services.review.start(packs);
    setScreen({ name: 'REVIEW', packs });
  }, [services, loadPacks, boot]);

  switch (screen.name) {
    case 'BOOT':
    case 'CATALOG_LOADING':
      return (
        <div className="center-screen" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>단어 목록을 불러오는 중…</p>
        </div>
      );
    case 'PACK_PREFETCH':
      return (
        <div className="center-screen" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>콘텐츠 다운로드 중 ({screen.loaded}/{screen.total})</p>
          <progress value={screen.loaded} max={screen.total} />
        </div>
      );
    case 'HOME': {
      const due = services.review && new Set(
        services.progress.all()
          .filter((p) => p.initial_learning_completed && p.next_review_at !== null && p.next_review_at <= Date.now())
          .map((p) => p.word_id),
      );
      const activePacks = screen.catalog.packs.filter((p) => p.status !== 'retired');
      const dueEntries = activePacks.filter((p) => due.has(p.word_id));
      return (
        <div className="home">
          <header className="app-header"><h1>Linkling</h1></header>
          {screen.fromCache && <p className="notice">오프라인 상태 — 마지막으로 받은 단어 목록을 사용합니다.</p>}
          {packErrors.map((e, i) => <p key={i} className="error-banner" role="alert">{e}</p>)}
          <section>
            <h2>오늘 학습</h2>
            <p className="hint-text">단어팩 {activePacks.length}개 사용 가능
              {screen.cached.length > 0 && ` · ${screen.cached.length}개 내려받음`}</p>
            <button className="primary" onClick={() => void startLearning(screen.catalog, activePacks)}>
              학습 시작
            </button>
            {dueEntries.length > 0 && (
              <button className="secondary" onClick={() => void startReview(screen.catalog, dueEntries)}>
                복습 시작 ({dueEntries.length}개 도래)
              </button>
            )}
          </section>
          <section>
            <h2>단어팩</h2>
            <ul className="pack-list">
              {activePacks.map((p) => (
                <li key={p.word_id}>
                  <span className="pack-word">{p.word}</span>
                  <span className={`pack-status pack-status-${p.status}`}>{p.status === 'preview' ? '미리보기' : '정식'}</span>
                  {screen.cached.some((c) => c.wordId === p.word_id) && <span className="pack-cached">저장됨</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      );
    }
    case 'LEARN':
      return (
        <LearnScreen
          engine={services.engine}
          audio={services.audio}
          evaluators={services.evaluators}
          onFinished={() => setScreen({ name: 'SUMMARY' })}
          onFatal={(messageKo) => setScreen({ name: 'ERROR_RECOVERY', messageKo, retry: () => void boot() })}
        />
      );
    case 'REVIEW':
      return (
        <ReviewScreen
          review={services.review}
          audio={services.audio}
          packs={screen.packs}
          onFinished={() => setScreen({ name: 'SUMMARY' })}
        />
      );
    case 'SUMMARY':
      return (
        <SummaryScreen
          engine={services.engine}
          telemetry={services.telemetry}
          progress={services.progress}
          onHome={() => void boot()}
        />
      );
    case 'ERROR_RECOVERY':
      return (
        <div className="center-screen">
          <p className="error-banner" role="alert">{screen.messageKo}</p>
          <button className="primary" onClick={screen.retry}>다시 시도</button>
        </div>
      );
  }
}
