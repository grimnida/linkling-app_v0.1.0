import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewSessionEngine, MeaningChoice } from '../core/ReviewSessionEngine';
import { buildMeaningChoices } from '../core/ReviewSessionEngine';
import type { AudioController } from '../core/AudioController';
import type { LoadedPack } from '../core/types';
import type { SceneAdapter } from '../core/SceneAdapter';
import { hasEnglishLetters } from '../core/PronunciationEvaluator';
import { SceneView } from './SceneView';

/**
 * 복습 화면 (본문서 §10.4·§5.7)
 * - 이미지·말풍선은 항상 유지, 한글 뜻만 성공 기반 희미화
 * - 뜻 확인 전 최소한의 인출 시간
 * - 자기 확인: 바로 떠올림 / 애매함 / 못 떠올림
 * - 객관식은 반복 실패 뒤 마지막 힌트로만
 */
export function ReviewScreen(props: {
  review: ReviewSessionEngine;
  audio: AudioController;
  packs: LoadedPack[];
  onFinished: () => void;
}): React.ReactElement {
  const { review, audio, packs } = props;
  const [, force] = useState(0);
  const rerender = useCallback(() => force((x) => x + 1), []);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false); // 확인(피드백) 단계
  const [choices, setChoices] = useState<MeaningChoice[] | null>(null);
  const adapterRef = useRef<SceneAdapter | null>(null);

  const item = review.current();
  const finished = !item;
  const { onFinished } = props;
  useEffect(() => { if (finished) onFinished(); }, [finished, onFinished]);

  const wp = item?.pack.wordpack ?? null;
  const fade = item ? review.meaningFadeLevel(item) : 100;
  const maxLayer = wp?.scene.layers.length ?? 0;

  const playFull = useCallback(async () => {
    if (!item || !wp) return;
    const url = item.pack.assetUrl(item.pack.manifest.audio.full_path);
    await audio.play(url, item.pack.manifest.status === 'preview' ? wp.word : undefined);
  }, [item, audio, wp]);

  const next = useCallback(() => {
    setTyped(''); setNotice(null); setRevealed(false); setChoices(null);
    rerender();
  }, [rerender]);

  const submitTyping = useCallback(async () => {
    if (!item) return;
    if (!hasEnglishLetters(typed)) {
      setNotice('영어 철자로 입력해 주세요');
      return;
    }
    const r = await review.submitProduction({ channel: 'text', text: typed, pageWasHidden: audio.isPageHidden, withinEchoWindow: audio.isWithinEchoWindow() });
    if (r.advanced) { setRevealed(true); }
    else setNotice('괜찮아요. 한 번 더 떠올려 볼까요?');
    setTyped('');
    rerender();
  }, [typed, review, audio, rerender]);

  const selfReport = useCallback((rating: 'instant' | 'unsure' | 'failed') => {
    if (!item) return;
    review.submitSelfReport(rating);
    if (rating === 'instant') setRevealed(true);
    else if (review.choicesAllowed(item)) setChoices(buildMeaningChoices(item.pack, packs));
    rerender();
  }, [review, item, packs, rerender]);

  if (!item || !wp) return <></>; // 복습 종료 — effect가 onFinished 처리

  const direction = item.direction;
  return (
    <div className="learn-screen review-screen">
      <header className="learn-header">
        <span>복습 · 남은 {review.remaining()}개</span>
        <span className="step-label">{directionLabelKo(direction)}</span>
      </header>
      <main className="learn-main">
        {/* 이미지+말풍선→발음, 또는 확인 단계: 항상 동일 장면 재사용 */}
        {(direction === 'scene-to-sound' || revealed) && (
          <>
            <SceneView
              pack={item.pack}
              reducedMotion={false}
              onReady={(a) => { adapterRef.current = a; a.setLayerStage(maxLayer); }}
              onError={(m) => setNotice(m)}
            />
            <p className="bubble-static">💬 {wp.speech_bubble.text_ko}</p>
          </>
        )}

        {direction === 'spelling-to-meaning' && !revealed && (
          <p className="spelling big-spelling">{wp.spelling_and_grammar.full_spelling}</p>
        )}
        {direction === 'audio-to-meaning' && !revealed && (
          <button className="primary big" onClick={() => void playFull()}>🔊 소리 듣기</button>
        )}

        {revealed && (
          <div className="review-feedback">
            {/* 확인 피드백: 이미지 → 말풍선 → 한글 뜻 순 (§5.7) — 뜻은 희미화 수준 반영 */}
            <p className="meaning" style={{ opacity: Math.max(fade, 12) / 100 }}>
              {fade === 0 ? <button className="secondary" onClick={rerender}>뜻 확인하기</button> : wp.lexical.core_meaning_ko}
            </p>
            <button className="primary" onClick={next}>다음</button>
          </div>
        )}

        {!revealed && direction === 'scene-to-sound' && (
          <footer className="input-bar">
            {notice && <p className="input-notice">{notice}</p>}
            <p className="instruction">장면과 말풍선을 보고 영어 단어를 말해 보세요</p>
            <form className="typing-row" onSubmit={(e: { preventDefault(): void }) => { e.preventDefault(); void submitTyping(); }}>
              <input value={typed} onChange={(e: { target: { value: string } }) => setTyped(e.target.value)} placeholder="타이핑으로 입력 (영어 철자)" aria-label="영어 철자 입력" />
              <button type="submit" disabled={typed.length === 0}>제출</button>
            </form>
            {item.attemptIndex >= 3 && (
              <button className="secondary" onClick={() => { review.completeAssisted(); next(); }}>
                정답 확인 후 따라 말했어요
              </button>
            )}
          </footer>
        )}

        {!revealed && direction !== 'scene-to-sound' && !choices && (
          <footer className="input-bar">
            {notice && <p className="input-notice">{notice}</p>}
            <p className="instruction">뜻을 먼저 떠올려 보세요</p>
            <div className="mock-row">
              <button onClick={() => selfReport('instant')}>바로 떠올랐어요</button>
              <button onClick={() => selfReport('unsure')}>애매해요</button>
              <button onClick={() => selfReport('failed')}>못 떠올렸어요</button>
            </div>
          </footer>
        )}

        {choices && (
          <div className="choice-panel">
            <p className="instruction">마지막 힌트 — 뜻을 골라 보세요</p>
            {choices.map((c, i) => (
              <button
                key={i}
                className="choice"
                onClick={() => {
                  const r = review.submitChoice(c);
                  if (r.correct) { setRevealed(true); setChoices(null); }
                  else setNotice('다시 골라 볼까요?');
                  rerender();
                }}
              >
                {c.meaningKo}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function directionLabelKo(d: string): string {
  switch (d) {
    case 'scene-to-sound': return '장면 → 발음';
    case 'spelling-to-meaning': return '철자 → 의미';
    case 'audio-to-meaning': return '소리 → 의미';
    default: return '복습';
  }
}
