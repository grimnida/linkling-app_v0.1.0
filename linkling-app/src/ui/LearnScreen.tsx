import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearningSessionEngine, CurrentStep } from '../core/LearningSessionEngine';
import type { AudioController } from '../core/AudioController';
import type { SceneAdapter } from '../core/SceneAdapter';
import type { AssessmentChannel, PronunciationEvaluator } from '../core/types';
import { MockPronunciationEvaluator, hasEnglishLetters } from '../core/PronunciationEvaluator';
import { CONFIG } from '../core/config';
import { SceneView } from './SceneView';

type FinalPhase =
  | 'idle' | 'integrating' | 'audio' | 'animating' | 'freeze'
  | 'bubble' | 'meaning' | 'spelling' | 'done';

/**
 * 학습 화면 (본문서 §10.2·§10.3)
 * 상단 진행도 / 중앙 장면 / 하단 컨트롤. 현재 단계에 불필요한 철자·뜻은 숨긴다.
 * 최종 결합 Sequence는 SceneAdapter 이벤트로 계약 순서를 강제한다 (§5.6).
 */
export function LearnScreen(props: {
  engine: LearningSessionEngine;
  audio: AudioController;
  evaluators: { speech: PronunciationEvaluator; text: PronunciationEvaluator };
  onFinished: () => void;
  onFatal: (messageKo: string) => void;
}): React.ReactElement {
  const { engine, audio } = props;
  const [step, setStep] = useState<CurrentStep>(() => engine.getCurrentStep());
  const [busy, setBusy] = useState(false); // 판정 중 중복 입력 방지·빠른 연속 탭 직렬화
  const [typed, setTyped] = useState('');
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [helpOffered, setHelpOffered] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [finalPhase, setFinalPhase] = useState<FinalPhase>('idle');
  const [wordCount, setWordCount] = useState({ done: 0, total: 0 });
  const adapterRef = useRef<SceneAdapter | null>(null);
  const promptEndedAtRef = useRef<number | null>(null);
  const helpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalStartedRef = useRef(false);
  const reducedMotion = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const refresh = useCallback(() => {
    const s = engine.getCurrentStep();
    setStep(s);
    setTyped('');
    setInputNotice(null);
    setHelpOffered(false);
    setFinalPhase((p) => (s.stepType === 'FINAL_INTEGRATION' ? p : 'idle'));
    if (s.stepType !== 'FINAL_INTEGRATION') finalStartedRef.current = false;
  }, [engine]);

  // 무응답 3초 = 도움 제안 시점 (실패 아님 — 부속 명세 §5)
  useEffect(() => {
    if (helpTimerRef.current) clearTimeout(helpTimerRef.current);
    if (step.stepType === 'CHUNK_RECALL' || step.stepType === 'FULL_WORD_RECALL') {
      helpTimerRef.current = setTimeout(() => setHelpOffered(true), CONFIG.HELP_OFFER_MS);
    }
    return () => { if (helpTimerRef.current) clearTimeout(helpTimerRef.current); };
  }, [step]);

  useEffect(() =>

    () => { if (helpTimerRef.current) clearTimeout(helpTimerRef.current); }, []);

  // 세션 종료 감지 — 렌더 중 상위 상태 변경 금지, effect에서 처리
  const finished = !step.pack;
  const { onFinished } = props;
  useEffect(() => { if (finished) onFinished(); }, [finished, onFinished]);

  const pack = step.pack; // finished일 때만 null — 아래 훅들은 null 가드 포함
  const wp = pack?.wordpack ?? null;
  const chunks = wp?.pronunciation.chunks ?? [];

  /** 단계 오디오 재생 (검수 AAC → 없으면 preview 한정 TTS fallback) */
  const playStepAudio = useCallback(async (kind: 'full' | 'chunk', chunkOrder?: number) => {
    if (!pack || !wp) return { ok: false, kind: null, blocked: false, endedAt: null };
    const manifest = pack.manifest;
    let url: string | null = null;
    let tts: string | undefined;
    if (kind === 'full') {
      url = pack.assetUrl(manifest.audio.full_path);
      tts = wp.word;
    } else {
      const c = manifest.audio.chunks.find((x) => x.order === chunkOrder);
      url = c ? pack.assetUrl(c.path) : null;
      tts = chunks[(chunkOrder ?? 1) - 1]?.cumulative_spelling;
    }
    const result = await audio.play(url, manifest.status === 'preview' ? tts : undefined);
    if (result.blocked) setAudioBlocked(true);
    promptEndedAtRef.current = Date.now();
    return result;
  }, [pack, audio, wp, chunks]);

  /** 판정 제출 — 채널 공통 */
  const submit = useCallback(async (channel: AssessmentChannel, text?: string) => {
    if (busy) return;
    if (channel === 'text') {
      if (!hasEnglishLetters(text ?? '')) {
        setInputNotice('영어 철자로 입력해 주세요'); // 제출 전 검사 — 미제출 (부속 명세 §3.1)
        return;
      }
    }
    setBusy(true);
    try {
      const outcome = await engine.submitAttempt({
        channel,
        text,
        pageWasHidden: audio.isPageHidden,
        withinEchoWindow: audio.isWithinEchoWindow(),
        promptEndedAt: promptEndedAtRef.current,
      });
      if (outcome.reliability === 'invalid') {
        setInputNotice('입력이 잘 전달되지 않았어요. 마이크·소리 상태를 확인하고 다시 해 볼까요?');
      } else if (outcome.needsReconfirm) {
        setInputNotice('잘 안 들렸어요. 한 번만 다시 말해 주세요.');
      } else if (outcome.advanced) {
        refresh();
      } else {
        setInputNotice(outcome.assistedPath
          ? '정답 발음을 듣고 따라 말해 보세요.'
          : '괜찮아요. 한 번 더 해 볼까요?');
        setStep(engine.getCurrentStep());
      }
      if (outcome.suggestTyping) {
        setInputNotice('음성이 계속 인식되지 않네요. 타이핑으로 입력해 볼까요?');
      }
    } finally {
      setBusy(false);
      setTyped('');
    }
  }, [busy, engine, audio, refresh]);

  /** 개발용 수동 판정 (Mock — 실제 provider는 [확인 필요]) */
  const mockJudge = useCallback(async (kind: 'pass' | 'near' | 'fail') => {
    const mock = props.evaluators.speech as MockPronunciationEvaluator;
    mock.enqueue(kind === 'pass'
      ? { passed: true, confidence: 0.9, clarityScore: 0.9 }
      : kind === 'near'
        ? { passed: false, confidence: 0.9, clarityScore: 0.7 }
        : { passed: false, confidence: 0.9, clarityScore: 0.2 });
    await submit('speech');
  }, [props.evaluators, submit]);

  /** 힌트 사다리 (§5.4): 1 생각 시간 → 2 첫소리 → 3 전체 누적 음원(뒤 재발화) */
  const useHint = useCallback(async () => {
    const level = engine.requestHint();
    setStep(engine.getCurrentStep());
    if (level === 2) {
      setInputNotice(`첫소리: "${(step.chunkOrder ? chunks[step.chunkOrder - 1] : chunks[chunks.length - 1]).cumulative_spelling[0]}"`);
    } else if (level === 3) {
      await playStepAudio('chunk', step.chunkOrder ?? chunks.length);
      setInputNotice('들은 대로 직접 말해 보세요.'); // 정답 음원 뒤 반드시 재발화
    }
  }, [engine, step, chunks, playStepAudio]);

  /** §5.6 최종 결합 Sequence — SceneAdapter 이벤트 순서 고정 */
  const runFinalSequence = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter || finalStartedRef.current) return;
    finalStartedRef.current = true;
    setFinalPhase('integrating');
    const off = adapter.onEvent((e) => {
      if (e.name === 'request_full_audio') {
        setFinalPhase('audio');
        void playStepAudio('full').then(() => {
          adapter.triggerFullAudioComplete();
          setFinalPhase('animating');
        });
      } else if (e.name === 'final_animation_complete') {
        setFinalPhase('freeze');
        setTimeout(() => {
          adapter.setLabelStage(1);
          setFinalPhase('bubble');
        }, CONFIG.BUBBLE_DELAY_MS); // 150~300ms 뒤 말풍선
      }
    });
    adapter.triggerFinalPass();
    // cleanup은 화면 전환 시 SceneView dispose가 담당
    void off;
  }, [playStepAudio]);

  useEffect(() => {
    if (step.stepType === 'FINAL_INTEGRATION' && adapterRef.current && finalPhase === 'idle') {
      runFinalSequence();
    }
  }, [step.stepType, finalPhase, runFinalSequence]);

  const onSceneReady = useCallback((adapter: SceneAdapter) => {
    adapterRef.current = adapter;
    adapter.setLayerStage(step.layerStage);
    if (step.stepType === 'FINAL_INTEGRATION' && !finalStartedRef.current) runFinalSequence();
  }, [step, runFinalSequence]);

  // 층 공개 동기화
  useEffect(() => {
    adapterRef.current?.setLayerStage(step.layerStage);
  }, [step.layerStage, step.pack?.entry.word_id]);

  useEffect(() => {
    const total = wordCount.total;
    void total;
  }, [wordCount]);

  if (!pack || !wp) return <></>; // 세션 종료 — effect가 onFinished 처리

  const grammar = wp.spelling_and_grammar.grammar_skeleton;
  const isRecall = step.stepType === 'CHUNK_RECALL' || step.stepType === 'FULL_WORD_RECALL';
  const currentChunk = step.chunkOrder ? chunks[step.chunkOrder - 1] : chunks[chunks.length - 1];

  return (
    <div className="learn-screen">
      <header className="learn-header">
        <span>{wp.word}{step.isRetest ? ' · 다시 확인' : ''}</span>
        <span className="step-label">{stepLabelKo(step.stepType)}</span>
      </header>

      <main className="learn-main">
        <SceneView
          pack={pack}
          reducedMotion={reducedMotion}
          hidden={step.stepType === 'FULL_AUDIO_PREVIEW'} /* §5.2: 이미지 숨김 */
          onReady={onSceneReady}
          onError={props.onFatal}
        />

        {/* §5.2 첫 노출: 재생 버튼 + 간단한 파형 표현만 */}
        {step.stepType === 'FULL_AUDIO_PREVIEW' && (
          <div className="preview-panel">
            <div className="waveform" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 37) % 28)}px` }} />)}</div>
            <button className="primary big" disabled={busy} onClick={() => void playStepAudio('full')}>
              🔊 전체 발음 듣기
            </button>
            <button className="secondary" disabled={busy} onClick={() => { engine.completePreview(); refresh(); }}>
              다음
            </button>
          </div>
        )}

        {step.stepType === 'CHUNK_ENCODING' && (
          <div className="encode-panel">
            <p className="instruction">소리를 듣고 따라 말해 보세요</p>
            <button className="primary" disabled={busy} onClick={() => void playStepAudio('chunk', step.chunkOrder ?? 1)}>
              🔊 소리 듣기
            </button>
          </div>
        )}

        {isRecall && (
          <div className="recall-panel">
            <p className="instruction">
              {step.stepType === 'FULL_WORD_RECALL'
                ? '완성된 장면을 보고, 소리 없이 전체 단어를 말해 보세요'
                : '장면을 보고 아까 그 소리를 떠올려 말해 보세요'}
            </p>
            {helpOffered && !step.assistedPath && step.hintLevel < 3 && (
              <button className="secondary" onClick={() => void useHint()}>도움받기</button>
            )}
          </div>
        )}

        {step.stepType === 'FINAL_INTEGRATION' && (
          <FinalPanel
            phase={finalPhase}
            bubbleTextKo={wp.speech_bubble.text_ko}
            meaningKo={wp.lexical.core_meaning_ko}
            spelling={wp.spelling_and_grammar.full_spelling}
            grammarKo={grammar?.enabled ? grammar.pattern_ko ?? null : null}
            onBubbleTap={() => { adapterRef.current?.setLabelStage(2); setFinalPhase('meaning'); }}
            onMeaningTap={() => {
              adapterRef.current?.triggerMeaningAbsorb();
              adapterRef.current?.setLabelStage(3);
              setFinalPhase('spelling');
            }}
            onReplay={() => adapterRef.current?.triggerReplayFinal()}
            onDone={() => { engine.completeFinalSequence(); refresh(); }}
          />
        )}
      </main>

      {(step.stepType === 'CHUNK_ENCODING' || isRecall) && (
        <footer className="input-bar">
          {inputNotice && <p className="input-notice" role="status">{inputNotice}</p>}
          {audioBlocked && (
            <p className="input-notice">소리 자동 재생이 막혀 있어요. 위의 듣기 버튼을 눌러 주세요.</p>
          )}
          {step.assistedPath ? (
            <div className="assisted-row">
              <button className="primary" disabled={busy} onClick={() => void playStepAudio('chunk', step.chunkOrder ?? chunks.length)}>
                🔊 정답 발음 듣기
              </button>
              <button className="secondary" disabled={busy} onClick={() => { engine.completeAssistedRepeat(); refresh(); }}>
                따라 말했어요
              </button>
            </div>
          ) : (
            <>
              <div className="mock-row" aria-label="개발용 발음 판정 (실제 판정 연결 전)">
                <button disabled={busy} onClick={() => void mockJudge('pass')}>🎤 정확히 말했어요</button>
                <button disabled={busy} onClick={() => void mockJudge('near')}>비슷하게 말했어요</button>
                <button disabled={busy} onClick={() => void mockJudge('fail')}>잘 안 됐어요</button>
              </div>
              <form
                className="typing-row"
                onSubmit={(e: { preventDefault(): void }) => { e.preventDefault(); void submit('text', typed); }}
              >
                <input
                  type="text"
                  value={typed}
                  placeholder="타이핑으로 입력 (영어 철자)"
                  aria-label="영어 철자 입력"
                  onChange={(e: { target: { value: string } }) => setTyped(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <button type="submit" disabled={busy || typed.length === 0}>제출</button>
              </form>
              <p className="expected-hint" aria-hidden="true">
                {step.stepType === 'CHUNK_ENCODING' ? `따라 말하기: ${currentChunk.cumulative_spelling}` : ''}
              </p>
            </>
          )}
        </footer>
      )}
    </div>
  );
}

function FinalPanel(props: {
  phase: FinalPhase;
  bubbleTextKo: string;
  meaningKo: string;
  spelling: string;
  grammarKo: string | null;
  onBubbleTap: () => void;
  onMeaningTap: () => void;
  onReplay: () => void;
  onDone: () => void;
}): React.ReactElement {
  const { phase } = props;
  const locked = phase === 'integrating' || phase === 'audio' || phase === 'animating'; // 최종 애니메이션 중 조작 잠금
  return (
    <div className="final-panel" aria-live="polite">
      {locked && <p className="instruction">장면이 완성되는 중…</p>}
      {phase === 'bubble' && (
        <button className="bubble" onClick={props.onBubbleTap}>
          💬 {props.bubbleTextKo}
          <span className="tap-hint">탭해서 계속</span>
        </button>
      )}
      {phase === 'meaning' && (
        <button className="meaning" onClick={props.onMeaningTap}>
          {props.meaningKo}
          <span className="tap-hint">탭하면 장면에 흡수돼요</span>
        </button>
      )}
      {phase === 'spelling' && (
        <div className="spelling-block">
          <p className="spelling">{props.spelling}</p>
          {props.grammarKo && <p className="grammar">{props.grammarKo}</p>}
          <div className="final-actions">
            <button className="secondary" onClick={props.onReplay}>다시 보기</button>
            <button className="primary" onClick={props.onDone}>다음 단어</button>
          </div>
        </div>
      )}
    </div>
  );
}

function stepLabelKo(s: CurrentStep['stepType']): string {
  switch (s) {
    case 'FULL_AUDIO_PREVIEW': return '소리 먼저 듣기';
    case 'CHUNK_ENCODING': return '소리 따라 하기';
    case 'CHUNK_RECALL': return '떠올려 말하기';
    case 'FULL_WORD_RECALL': return '전체 단어 말하기';
    case 'FINAL_INTEGRATION': return '의미 만나기';
    case 'SESSION_SUMMARY': return '오늘 정리';
  }
}
