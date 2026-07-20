# PRONUNCIATION_PROVIDER_TODO

실제 프로덕션 발음 평가 provider는 **[확인 필요]** 상태다. 앱은 특정 음성 API에 결합되어 있지 않다.

## 지금 있는 것

- `PronunciationEvaluator` 인터페이스 (`src/core/types.ts`) — `evaluate(input) → { passed, confidence, clarityScore, matchedWord, missingSegments, providerRawResult }`
- `MockPronunciationEvaluator` — 개발·E2E용 (결과 큐 주입 가능)
- `ManualTypingEvaluator` — 타이핑 대체 채널. 계약: 정제 후 토큰이 비면 무조건 fail (한글만·숫자만·공백만 입력 자동 통과 버그의 회귀 방지 테스트 포함)
- `MeasurementReliability` 게이트 — provider와 무관한 정책 계층. provider의 confidence는 입력의 하나일 뿐

## provider 연결 시 할 일

1. `src/core/providers/<Name>Evaluator.ts`에 인터페이스 구현체 추가 (앱 다른 코드는 수정 금지)
2. pass profile 매핑: `PRON_CHUNK_LOOSE_V1`(느슨), `PRON_FULL_CLARITY_V1`(명료성 중심 — 원어민 억양 완전 일치 요구 금지)
3. 오류 매핑 규칙 (부속 명세 §3.2):
   - 권한 거부(`not-allowed` 계열) → 학습 실패로 기록 금지, 타이핑 채널 전환 + 안내
   - 지속 오류 → 연속 3회 무결과 시 타이핑 전환 제안 (무한 재시작 루프 금지 — 엔진에 이미 구현됨)
4. `App.tsx`의 evaluators.speech를 실제 구현체로 교체 (환경 변수/설정으로 선택 가능하게)
5. 에코 창: 모델 오디오 재생 직후 입력은 게이트가 uncertain 처리 — provider 쪽에서 별도 처리 불필요
6. §12.4 기기 QA: iOS Safari 마이크 권한, 재생 중 suspend/재개(AudioController가 onSuspendChange 제공 — 인식 루프 재시작 차단에 사용)

## 결정 필요 항목

- provider 선정 (브라우저 SpeechRecognition / 외부 API / 온디바이스)
- confidence 임계(현재 0.45, `CONFIG.CONFIDENCE_UNCERTAIN_THRESHOLD`)의 provider별 보정
- 오디오 Blob 수집 방식 (현재 인터페이스는 Blob 전달 준비됨)
