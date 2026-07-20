/**
 * AudioController (본문서 §7.8·§12.4 + 부속 명세 §3.3)
 * - iOS: 최초 사용자 제스처 안에서 AudioContext 언락(+무음 utterance)
 * - ended 미발화 대비 타임아웃 fallback
 * - 재생 중 마이크 suspend / 종료 후 resume, 에코 창 노출
 * - visibilitychange: 백그라운드 진입 시 중지, 복귀 시 언락·재개
 * - 자동 재생 차단 시 수동 재생 버튼 노출용 상태 제공
 * - 검수 AAC가 없을 때(fetch 실패)의 개발용 TTS fallback (preview 전용)
 */
import { CONFIG } from './config';

export type AudioSourceKind = 'file' | 'tts-fallback';

export interface PlayResult {
  ok: boolean;
  kind: AudioSourceKind | null;
  blocked: boolean; // 자동 재생 차단 → 수동 재생 버튼 필요
  endedAt: number | null;
}

export class AudioController {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private currentAudio: HTMLAudioElement | null = null;
  private lastPlaybackEndedAt = 0;
  private hiddenSince: number | null = null;
  private suspendListeners = new Set<(suspended: boolean) => void>();

  constructor(private readonly now: () => number = Date.now) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.hiddenSince = this.now();
          this.stop();
          try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* noop */ }
        } else {
          this.hiddenSince = null;
          void this.unlock();
        }
      });
    }
  }

  /** 최초 사용자 제스처 안에서 호출 (iOS 오디오 언락) */
  async unlock(): Promise<void> {
    try {
      if (typeof AudioContext !== 'undefined') {
        this.ctx = this.ctx ?? new AudioContext();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
      }
      if (!this.unlocked && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        speechSynthesis.speak(silent);
      }
      this.unlocked = true;
    } catch { /* 언락 실패 → 수동 재생 UI 경로 */ }
  }

  get isUnlocked(): boolean { return this.unlocked; }
  get isPageHidden(): boolean { return this.hiddenSince !== null; }

  /** 직전 재생 종료 후 에코 창 안인지 (음성 입력 신뢰도 판단용) */
  isWithinEchoWindow(): boolean {
    return this.now() - this.lastPlaybackEndedAt < CONFIG.ECHO_WINDOW_MS;
  }

  /** 재생 중 마이크 suspend 알림 구독 (suspend 상태에서 인식 루프 재시작 차단용) */
  onSuspendChange(cb: (suspended: boolean) => void): () => void {
    this.suspendListeners.add(cb);
    return () => this.suspendListeners.delete(cb);
  }

  private notifySuspend(s: boolean): void {
    for (const cb of this.suspendListeners) cb(s);
  }

  /**
   * 오디오 파일 재생. 실패 시(파일 없음 등) ttsFallbackText가 있으면 TTS로 대체
   * — .riv·검수 오디오 준비 전 preview 전용 경로 (본문서 §8.6).
   */
  async play(url: string | null, ttsFallbackText?: string): Promise<PlayResult> {
    if (this.isPageHidden) return { ok: false, kind: null, blocked: false, endedAt: null };
    this.stop();
    this.notifySuspend(true); // 재생 중 마이크 suspend
    try {
      if (url) {
        const result = await this.playFile(url);
        if (result.ok || result.blocked) return result;
      }
      if (ttsFallbackText) {
        return await this.playTts(ttsFallbackText);
      }
      return { ok: false, kind: null, blocked: false, endedAt: null };
    } finally {
      this.lastPlaybackEndedAt = this.now();
      this.notifySuspend(false); // 종료 후 resume
    }
  }

  private playFile(url: string): Promise<PlayResult> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      this.currentAudio = audio;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const settle = (r: PlayResult) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.currentAudio = null;
        resolve(r);
      };

      const armTimeout = () => {
        // ended 미발화 대비 fallback — duration 기반 + 여유
        const durMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 8000;
        timeout = setTimeout(() => settle({ ok: true, kind: 'file', blocked: false, endedAt: this.now() }),
          durMs + CONFIG.AUDIO_ENDED_TIMEOUT_EXTRA_MS);
      };

      audio.addEventListener('loadedmetadata', armTimeout, { once: true });
      audio.addEventListener('ended', () => settle({ ok: true, kind: 'file', blocked: false, endedAt: this.now() }), { once: true });
      audio.addEventListener('error', () => settle({ ok: false, kind: null, blocked: false, endedAt: null }), { once: true });

      const p = audio.play();
      if (p) {
        p.catch((err: unknown) => {
          const name = (err as { name?: string })?.name ?? '';
          if (name === 'NotAllowedError') {
            settle({ ok: false, kind: null, blocked: true, endedAt: null }); // 수동 재생 버튼 노출
          } else {
            settle({ ok: false, kind: null, blocked: false, endedAt: null });
          }
        });
      }
      // 메타데이터가 아예 안 오는 경우 대비 최후 타임아웃
      setTimeout(() => { if (!settled && !timeout) armTimeout(); }, 4000);
    });
  }

  private playTts(text: string): Promise<PlayResult> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve({ ok: false, kind: null, blocked: false, endedAt: null });
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.85;
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve({ ok, kind: ok ? 'tts-fallback' : null, blocked: false, endedAt: ok ? this.now() : null });
      };
      // TTS 타임아웃 (iOS onend 미발화 사례 대비)
      const timeout = setTimeout(() => { try { speechSynthesis.cancel(); } catch { /* noop */ } settle(true); },
        Math.max(3000, text.length * 350));
      u.onend = () => { clearTimeout(timeout); settle(true); };
      u.onerror = () => { clearTimeout(timeout); settle(false); };
      try { speechSynthesis.cancel(); } catch { /* noop */ }
      speechSynthesis.speak(u);
    });
  }

  stop(): void {
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch { /* noop */ }
      this.currentAudio = null;
    }
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* noop */ }
  }
}
