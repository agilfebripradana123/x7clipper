import { z } from 'zod';

const autoEditSchema = z.object({
  hook_banner_text: z.string().max(100).optional(),
  recommended_layout: z.enum(['full_crop', 'blur_bg']).optional(),
  highlight_keywords: z.array(z.string()).optional(),
}).optional();

const clipSchema = z.object({
  title: z.string().min(1).max(60),
  start_segment_id: z.string().regex(/^S\d+$/),
  end_segment_id: z.string().regex(/^S\d+$/),
  viral_score: z.number().int().min(1).max(100),
  hook_type: z.enum(['contrarian', 'story', 'actionable_tip', 'emotional', 'debate']),
  reason: z.string().min(1),
  suggested_caption: z.string().min(1),
  auto_edit: autoEditSchema,
});

/** Validasi respons AI, resolve Segment-ID, lalu tambah safety padding. */
export function validateClips(rawClips, segmentMap, videoDuration) {
  if (!Array.isArray(rawClips)) return [];

  const valid = [];
  for (const raw of rawClips) {
    const parsed = clipSchema.safeParse(raw);
    if (!parsed.success) continue;

    const clip = parsed.data;
    const startSegment = segmentMap[clip.start_segment_id];
    const endSegment = segmentMap[clip.end_segment_id];
    if (!startSegment || !endSegment || endSegment.end <= startSegment.start) continue;

    const start_sec = Math.max(0, startSegment.start - 0.35);
    const end_sec = Math.min(videoDuration, endSegment.end + 0.5);
    const duration = end_sec - start_sec;
    if (duration < 15 || duration > 110) continue;

    valid.push({ ...clip, start_sec, end_sec });
  }
  return valid;
}

/** Hapus klip bertumpuk >50%; prioritaskan viral_score tertinggi. */
export function deduplicateClips(clips) {
  const selected = [];

  for (const clip of [...clips].sort((a, b) => b.viral_score - a.viral_score)) {
    const overlapsSelected = selected.some((kept) => {
      const overlap = Math.max(0, Math.min(clip.end_sec, kept.end_sec) - Math.max(clip.start_sec, kept.start_sec));
      const shorterDuration = Math.min(clip.end_sec - clip.start_sec, kept.end_sec - kept.start_sec);
      return overlap > shorterDuration * 0.5;
    });
    if (!overlapsSelected) selected.push(clip);
  }

  return selected.sort((a, b) => a.start_sec - b.start_sec);
}
