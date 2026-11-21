import { extractSampleFrames, buildIndexedCues } from './perception.js';
import { determineFraming } from './visionFramer.js';
import { determinePacing } from './semanticPacer.js';

/**
 * Orchestrator Utama: Autonomous Auto-Editor Agent.
 * Menjalankan Vision Framing + Semantic Pacer, lalu menghasilkan edit_config_json matang.
 */
export async function runAutoEditorAgent({
  clipPath,
  durationSec,
  shiftedSubtitles = [],
  clipMeta = {},
  tmpDir,
  extractFramesFn = extractSampleFrames,
  determineFramingFn = determineFraming,
  determinePacingFn = determinePacing,
  log = () => {},
} = {}) {
  const autoEditMeta = clipMeta.auto_edit || {};
  const clipTitle = clipMeta.title || '';

  log(`[AutoEditorAgent] Memulai analisis klip: "${clipTitle}" (${durationSec}s)`);

  // 1. Ekstrak 3 frame sampel visual
  let framesBase64 = [];
  try {
    framesBase64 = await extractFramesFn(clipPath, durationSec, tmpDir);
    log(`[AutoEditorAgent] Berhasil ekstrak ${framesBase64.length} frame visual`);
  } catch (err) {
    log(`[AutoEditorAgent] Gagal ekstrak frame visual: ${err.message}. Lanjut fallback framing.`);
  }

  // 2. Sub-Agent 1: Vision Framing
  const framing = await determineFramingFn(framesBase64, clipTitle, {
    fallbackLayout: autoEditMeta.recommended_layout || 'full_crop',
    fallbackCropX: 0.5,
  });
  log(`[AutoEditorAgent] Framing: layout=${framing.layout_mode}, crop_x=${framing.crop_x} (${framing.framing_reason})`);

  // 3. Sub-Agent 2: Perception Cues & Semantic Pacing Loop
  const { formattedCues, cueMap } = buildIndexedCues(shiftedSubtitles);
  const pacing = await determinePacingFn(formattedCues, cueMap, durationSec, {
    clipTitle,
    fallbackHookText: autoEditMeta.hook_banner_text || clipTitle,
    fallbackKeywords: autoEditMeta.highlight_keywords || [],
  });
  log(`[AutoEditorAgent] Pacing: ${pacing.cuts.length} cuts, iterasi=${pacing.iterations} (${pacing.pacing_reason})`);

  // 4. Susun edit_config_json lengkap siap pakai
  const editConfig = {
    aspect_ratio: '9:16',
    crop_x: framing.crop_x,
    layout_mode: framing.layout_mode === 'blur_bg' ? 'blur' : 'crop',
    preset: framing.layout_mode === 'blur_bg' ? 'podcast' : 'hormozi',
    hook_banner: {
      enabled: true,
      text: pacing.hook_banner_text || autoEditMeta.hook_banner_text || clipTitle.toUpperCase(),
    },
    cuts: pacing.cuts,
    trim_start: 0,
    trim_end: Number(durationSec.toFixed(3)),
    subtitle: {
      enabled: true,
      position: framing.layout_mode === 'blur_bg' ? 'bottom' : 'middle',
      font_size: framing.layout_mode === 'blur_bg' ? 42 : 50,
      color: '#FFFFFF',
      highlight_color: '#FFE600',
      highlight_keywords: pacing.highlight_keywords || [],
    },
    agent_notes: {
      framing_reason: framing.framing_reason,
      pacing_reason: pacing.pacing_reason,
      iterations: pacing.iterations,
      generated_at: new Date().toISOString(),
    },
  };

  return editConfig;
}
