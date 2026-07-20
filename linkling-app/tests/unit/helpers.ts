import type {
  CatalogPackEntry, LoadedPack, PackManifest, RuntimeWordpack, WordProgress,
} from '../../src/core/types';
import type { ProgressRepository } from '../../src/core/ProgressStore';

/** n층(=n chunk) 합성 팩 — 2·3·4층 처리 검증용 (단어별 분기 없음을 함께 증명) */
export function makePack(wordId: string, word: string, layerCount: number): LoadedPack {
  const chunks = Array.from({ length: layerCount }, (_, i) => ({
    order: i + 1,
    cumulative_ipa: `/x${i + 1}/`,
    cumulative_spelling: word.slice(0, Math.ceil(((i + 1) / layerCount) * word.length)),
    audio_asset_id: `audio/chunk_0${i + 1}.aac`,
    pass_profile_id: 'PRON_CHUNK_LOOSE_V1',
    is_full_word: i === layerCount - 1,
  }));
  const layers = Array.from({ length: layerCount }, (_, i) => ({
    order: i + 1,
    unlock_trigger: { type: 'chunk_pass' as const, chunk_order: i + 1 },
    semantic_roles: ['subject'],
    group_ids: [`g${i + 1}`],
    description_ko: `층 ${i + 1}`,
    persists_after_reveal: true,
    same_camera_frame: true,
    uses_chunk_color_link: false,
    reveal_preset_id: 'LAYER_FADE_IN_LOCK_V1',
  }));
  const wordpack: RuntimeWordpack = {
    schema_version: '1.0.0',
    wordpack_version: '0.1.0',
    word_id: wordId,
    word,
    template_id: 'V_TRANSITIVE_SAO',
    status: 'in_review',
    lexical: {
      part_of_speech: 'verb',
      core_meaning_ko: `${word} 뜻`,
      accepted_meanings_ko: [`${word} 뜻`],
      excluded_meanings_ko: [],
      profile: { transitivity: 'transitive', base_voice: 'active' },
    },
    learning_scope: {},
    pronunciation: {
      dialect: 'american',
      ipa: '/test/',
      full_audio_asset_id: 'audio/full.aac',
      chunks,
      final_pass_profile_id: 'PRON_FULL_CLARITY_V1',
    },
    scene: { master_scene_asset_id: 'scene/master.svg', render_format: 'rive', summary_ko: '', layers },
    final_sequence: {
      order: ['soften_layer_boundaries', 'integrate_scene', 'replay_full_pronunciation', 'play_final_animation', 'freeze_keyframe', 'show_speech_bubble', 'show_core_meaning_ko', 'show_spelling_and_grammar'],
      animation: { duration_ms: 900, final_keyframe_id: 'kf' },
    },
    speech_bubble: { type: 'speech', text_ko: '테스트 말풍선', anchor_group_id: 'g1' },
    meaning_reveal: {},
    spelling_and_grammar: { full_spelling: word, spelling_chunks: [word] },
    review_policy: {},
    assets: {},
  };
  const entry: CatalogPackEntry = {
    word_id: wordId, word, wordpack_version: '0.1.0', status: 'preview',
    manifest_path: `packs/${wordId}/0.1.0/pack.json`,
  };
  const manifest: PackManifest = {
    schema_version: '1.0.0', word_id: wordId, word, wordpack_version: '0.1.0', status: 'preview',
    wordpack_path: 'wordpack.runtime.json',
    scene: {
      format: 'rive', availability: 'pending_rive_export', fallback_svg_path: 'scene/master.svg',
      artboard: 'Test', state_machine: 'LinklingWordpackSM', max_layer_stage: layerCount,
    },
    audio: { full_path: 'audio/full.aac', chunks: chunks.map((c) => ({ order: c.order, path: c.audio_asset_id })) },
  };
  const manifestUrl = `https://packs.test/packs/${wordId}/0.1.0/pack.json`;
  return {
    entry, manifest, manifestUrl, wordpack,
    assetUrl: (rel) => new URL(rel, manifestUrl).toString(),
  };
}

export class MemoryProgressRepository implements ProgressRepository {
  private data: Record<string, WordProgress> = {};
  loadAll(): Record<string, WordProgress> { return this.data; }
  saveAll(d: Record<string, WordProgress>): void { this.data = d; }
}

/** 간단한 fetch 대역 */
export function fakeFetch(routes: Record<string, { status?: number; json?: unknown; text?: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    const status = route.status ?? 200;
    if (route.json !== undefined) {
      return new Response(JSON.stringify(route.json), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(route.text ?? '', { status });
  }) as typeof fetch;
}
