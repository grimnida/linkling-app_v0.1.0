# RIVE_INTEGRATION

## 현재 상태

실제 `.riv` 바이너리는 아직 없다(본문서 §1 미완료 항목). **가짜 `.riv`는 만들지 않는다.** 모든 Wave 1 팩은 `scene.availability=pending_rive_export`로 배포되어 SVG fallback으로 동작한다.

## `.riv` drop-in 절차 (앱 코드 수정 불필요)

1. Rive Editor에서 단어별 build spec(`linkling-wordpacks/authoring/wave1/<word>/rive/`)대로 제작·export.
2. `linkling-wordpacks/authoring/wave1/<word>/scene/master.riv`로 저장.
3. `npm run build:content` — 빌드가 자동으로:
   - RIVE 매직바이트·크기 검증 (위조·빈 바이너리 차단)
   - manifest `scene.availability=ready`, `riv_path` 기록
   - `wordpack_version`을 올렸는지 불변성 검사로 확인
4. 배포하면 앱의 `SceneView`가 availability를 보고 자동으로 Rive 경로를 탄다.

## 런타임 계약 (본문서 §6 — 절대 고정)

상태 머신 이름 `LinklingWordpackSM`. 로드 시 `RiveRuntimeAdapter`가 다음을 검증하고, 하나라도 없으면 로드 실패로 처리한다(조용히 SVG로 빠지지 않고 오류 표시 후 fallback 여부는 preview 정책을 따름):

- inputs: `layer_stage`(0..4) `final_pass` `full_audio_complete` `label_stage`(0..3) `meaning_absorb` `replay_final` `reset` `reduced_motion`
- events: `request_full_audio` `final_animation_complete` `bubble_visible` `meaning_visible` `spelling_visible` `layer_revealed`

`prefers-reduced-motion`은 `reduced_motion` input으로 전달된다. 화면 전환 시 `rive.cleanup()`이 반드시 호출된다(SceneView unmount).

## production publish 차단 조건 (본문서 §8.6)

published 판정은 wordpacks 빌드가 다음을 모두 확인해야 내려진다: 실제 `.riv` 존재 + 검수 오디오 전체 존재 + authoring `qa.publish_ready=true` + status `approved`. 하나라도 없으면 preview로 유지된다.
