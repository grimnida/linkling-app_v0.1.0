/**
 * SVG fallback 장면 컨트롤러 (본문서 §8.6 — .riv가 준비되기 전 개발/preview 전용).
 * 마스터 SVG의 layer group opacity를 계약대로 제어한다.
 * - 동일 장면 누적: 층은 공개 후 사라지지 않는다
 * - 최종 시퀀스: 경계 약화 → 통합 → request_full_audio → (오디오) → 최종 모션 → 정지컷
 * - 말풍선·뜻·철자는 앱 UI 오버레이가 표시하되, 표시 시점은 이 컨트롤러의
 *   이벤트(final_animation_complete, bubble_visible, …)가 계약 순서대로 구동한다.
 */
import type { RuntimeWordpack } from './types';
import type { SceneAdapter, SceneEvent } from './SceneAdapter';

const REVEAL_MS = 280;
const SOFTEN_MS = 350;
const INTEGRATE_MS = 400;

export class SvgSceneController implements SceneAdapter {
  private layerStage = 0;
  private labelStage = 0;
  private reducedMotion = false;
  private listeners = new Set<(e: SceneEvent) => void>();
  private layerGroups: string[][] = [];
  private finalAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    svgText: string,
    private readonly wordpack: RuntimeWordpack,
  ) {
    // 팩 SVG는 빌드 파이프라인에서 스크립트·이벤트 핸들러·외부 참조가 차단된 상태다.
    this.host.innerHTML = svgText;
    const svg = this.host.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
      svg.style.display = 'block';
    }
    this.layerGroups = wordpack.scene.layers.map((l) => l.group_ids);
    this.applyStages(true);
  }

  private byId(id: string): SVGElement | null {
    return this.host.querySelector(`#${CSS.escape(id)}`);
  }

  private setGroupVisible(id: string, visible: boolean, animate: boolean): void {
    const el = this.byId(id);
    if (!el) return;
    el.style.transition = animate && !this.reducedMotion ? `opacity ${REVEAL_MS}ms ease` : 'none';
    el.style.opacity = visible ? '1' : '0';
  }

  private applyStages(initial = false): void {
    this.layerGroups.forEach((gids, i) => {
      const visible = i < this.layerStage;
      for (const gid of gids) this.setGroupVisible(gid, visible, !initial);
    });
    // 라벨 그룹(SVG 안 자리표시)은 숨김 유지 — 텍스트는 앱 오버레이가 그린다
    for (const gid of ['labels_speech_bubble', 'labels_core_meaning', 'labels_spelling_grammar']) {
      this.setGroupVisible(gid, false, false);
    }
  }

  setLayerStage(stage: number): void {
    const max = this.layerGroups.length;
    const next = Math.max(0, Math.min(stage, max));
    if (next < this.layerStage) return; // 층은 내려가지 않는다 (reset 제외)
    const prev = this.layerStage;
    this.layerStage = next;
    this.applyStages();
    if (next > prev) this.emit({ name: 'layer_revealed', payload: next });
  }

  getLayerStage(): number { return this.layerStage; }

  setLabelStage(stage: number): void {
    this.labelStage = stage;
    if (stage === 1) this.emit({ name: 'bubble_visible', payload: this.wordpack.word_id });
    if (stage === 2) this.emit({ name: 'meaning_visible', payload: this.wordpack.word_id });
    if (stage === 3) this.emit({ name: 'spelling_visible', payload: this.wordpack.word_id });
  }

  triggerFinalPass(): void {
    // 1) 층 경계 약화 → 2) 통합 → 3) request_full_audio
    const boundaries = this.byId('layer_boundaries');
    if (boundaries) {
      boundaries.style.transition = this.reducedMotion ? 'none' : `opacity ${SOFTEN_MS}ms ease`;
      boundaries.style.opacity = '0';
    }
    const highlight = this.byId('integration_highlight');
    const delay = this.reducedMotion ? 0 : SOFTEN_MS + INTEGRATE_MS;
    if (highlight && !this.reducedMotion) {
      highlight.style.transition = `opacity ${INTEGRATE_MS}ms ease`;
      highlight.style.opacity = '0.6';
      setTimeout(() => { highlight.style.opacity = '0'; }, SOFTEN_MS + INTEGRATE_MS);
    }
    setTimeout(() => {
      if (!this.disposed) this.emit({ name: 'request_full_audio', payload: this.wordpack.word_id });
    }, delay);
  }

  triggerFullAudioComplete(): void {
    this.playFinalAnimation();
  }

  triggerReplayFinal(): void {
    this.playFinalAnimation();
  }

  private playFinalAnimation(): void {
    if (this.finalAnimationTimer) return; // 빠른 연속 탭 중복 재생 방지
    const duration = this.reducedMotion ? 450 : (this.wordpack.final_sequence.animation?.duration_ms ?? 1200);
    const scene = this.byId('scene_root');
    if (scene && !this.reducedMotion) {
      scene.style.transformOrigin = '50% 50%';
      scene.style.transition = `transform ${duration / 2}ms ease-in-out`;
      scene.style.transform = 'scale(1.03)';
      setTimeout(() => { scene.style.transform = 'scale(1)'; }, duration / 2);
    } else if (scene && this.reducedMotion) {
      // 큰 움직임 대신 정적 강조
      const highlight = this.byId('integration_highlight');
      if (highlight) {
        highlight.style.transition = 'opacity 200ms ease';
        highlight.style.opacity = '0.6';
        setTimeout(() => { highlight.style.opacity = '0'; }, 400);
      }
    }
    this.finalAnimationTimer = setTimeout(() => {
      this.finalAnimationTimer = null;
      // 핵심 정지컷에서 멈춘 상태
      this.emit({ name: 'final_animation_complete', payload: this.wordpack.word_id });
    }, duration);
  }

  triggerMeaningAbsorb(): void {
    const scene = this.byId('scene_root');
    if (scene && !this.reducedMotion) {
      scene.style.transition = 'filter 300ms ease';
      scene.style.filter = 'brightness(1.08)';
      setTimeout(() => { scene.style.filter = 'none'; }, 320);
    }
  }

  triggerReset(): void {
    this.layerStage = 0;
    this.labelStage = 0;
    if (this.finalAnimationTimer) { clearTimeout(this.finalAnimationTimer); this.finalAnimationTimer = null; }
    const boundaries = this.byId('layer_boundaries');
    if (boundaries) { boundaries.style.transition = 'none'; boundaries.style.opacity = '0.42'; }
    this.applyStages(true);
  }

  setReducedMotion(value: boolean): void { this.reducedMotion = value; }

  onEvent(cb: (e: SceneEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: SceneEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    if (this.finalAnimationTimer) clearTimeout(this.finalAnimationTimer);
    this.host.innerHTML = '';
  }
}
