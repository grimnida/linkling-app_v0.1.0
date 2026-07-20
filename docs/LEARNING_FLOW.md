# LEARNING_FLOW

본문서 §4·§5의 규칙이 코드 어디에서 지켜지는지의 대응표다. 규칙 자체는 본문서가 원본이며 이 문서는 요약·매핑만 한다.

## 학생 Flow ↔ 구현 매핑

| Flow 단계 (본문서) | 구현 |
|---|---|
| §5.1 세션 시작 (catalog→프리페치→큐) | `App.startLearning` → `WordpackRepository`/`WordpackCache` → `LearningSessionEngine.startSession` |
| §5.2 전체 발음 첫 노출 (철자·이미지·말풍선·뜻 숨김) | `FULL_AUDIO_PREVIEW` 단계, `SceneView hidden`, 파형+재생 버튼만 |
| §5.3 새 Chunk 부호화 (누적 음원→층 공개→따라 말하기→고정→다른 단어) | `CHUNK_ENCODING` + `setLayerStage(n)` + pass 시 `requeueAfterGap` |
| §5.4 간격 뒤 인출 + 힌트 사다리 4단계 | `CHUNK_RECALL`, 실패 시 hintLevel 1(생각 시간)→2(첫소리)→3(전체 음원)→assisted 재발화 |
| §5.5 전체 단어 인출 (음원 없이, PRON_FULL_CLARITY_V1) | `FULL_WORD_RECALL` — `final_pass_profile_id` 사용 |
| §5.6 최종 결합 12단계 고정 순서 | `LearnScreen.runFinalSequence` + `SceneAdapter` 이벤트 (아래 상세) |
| §5.7 복습 3방향 + 뜻 희미화 | `ReviewSessionEngine` + `ProgressStore.applyFadeOnNoHintSuccess` |

## 최종 결합 Sequence 이벤트 흐름 (§5.6 — 순서 변경 금지)

```text
engine: FULL_WORD_RECALL pass
→ UI: adapter.triggerFinalPass()
→ scene: 경계 약화 → 통합 → emit request_full_audio
→ UI: 전체 발음 재생 (AudioController) → adapter.triggerFullAudioComplete()
→ scene: 최종 애니메이션 → 핵심 정지컷 → emit final_animation_complete
→ UI: 150~300ms 뒤 label_stage=1 (말풍선)
→ 학생 탭 → label_stage=2 (한글 뜻)
→ 뜻 탭 → meaning_absorb → label_stage=3 (철자·문형)
→ engine.completeFinalSequence()
```

## 절대 규칙의 강제 지점

- **동일 장면 누적**: `SvgSceneController.setLayerStage`는 층을 내리지 않는다(reset 제외). 팩 빌드 시 `persists_after_reveal=true` 검증.
- **Chunk는 해금 열쇠**: Chunk UI에 색·라벨 대응 없음. 팩 빌드에서 `uses_chunk_color_link=false` 강제. Sound Anchor 데이터는 어떤 형태로도 없음 (부속 §6.1 이식 금지).
- **애니메이션은 마지막에만**: Chunk 진행 중에는 opacity 공개만. `playFinalAnimation`은 FINAL_INTEGRATION에서만 호출되고 중복 재생이 차단된다.
- **복습에서 이미지·말풍선 유지, 한글 뜻만 희미화**: `ReviewScreen`은 장면·말풍선을 항상 렌더, 뜻만 `meaning_fade_level` 반영. 날짜만으로는 절대 희미화하지 않는다.
- **객관식은 마지막 힌트**: `ReviewSessionEngine.choicesAllowed` = 실패 2회 + 힌트 3 이후에만. 성공해도 재인으로만 기록.
- **문맥 문제 없음**: 어떤 화면에도 예문·문맥 문항 없음.
- **무응답 3초 = 도움 제안**: `CONFIG.HELP_OFFER_MS`, 시간 압박 실패 없음.
- **시도 상한 + assisted 탈출구**: `CONFIG.MAX_PRODUCTION_ATTEMPTS`, 모든 산출 단계 공통.

## 측정·기록 (부속 명세 §2)

Raw Event 필드는 `src/core/types.ts`의 `RawLearningEvent`가 §2.1과 1:1이다. 승격·희미화 규칙은 `ProgressStore`:

- independent 승격·무힌트 성공 카운트 = reliable + hintLevel 0 + 산출 채널만
- touch-choice 성공 = recognition_success_count만 (숙달 증거 아님)
- 즉시/지연 성공은 `isDelayedRecall` 차원으로 분리, stable 승격은 지연 reliable 성공만
- invalid = 통로 문제 → invalid_event_count 관찰만
