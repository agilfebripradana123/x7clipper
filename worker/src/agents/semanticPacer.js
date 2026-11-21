import { z } from 'zod';
import { cleanJsonString, parseResponseText } from '../ninerouter.js';
import { detectJumpCuts } from '../subtitleShift.js';

const pacingSchema = z.object({
  drop_cue_ids: z.array(z.string()),
  hook_banner_text: z.string().max(60).optional(),
  highlight_keywords: z.array(z.string()).optional(),
  pacing_reason: z.string().min(1),
});

const PACER_SYSTEM_PROMPT = `Kamu adalah Editor Video Shorts/Reels profesional dengan spesialisasi tempo cepat, retensi tinggi, dan tanpa dead-air.
Tugasmu menerima naskah cue bertimestamp [C1|start-end], lalu memilih daftar "drop_cue_ids" untuk dibuang agar video padat, to-the-point, dan berdurasi ideal antara 25 sampai 58 detik (maksimal 58 detik).

ATURAN EDITORIAL:
1. "drop_cue_ids": Daftar ID cue yang HARUS DIHAPUS. Buang bagian basa-basi pembuka, salam bertele-tele, jeda canggung/filler berulang, atau penjelasan sampingan yang membosankan.
2. JANGAN PERNAH menghapus hook kalimat pembuka pertama atau punchline kalimat penutup di akhir.
3. "hook_banner_text": Tulis ulang/sempurnakan judul hook maksimal 6 KATA (KAPITAL SEMUA) yang sangat memancing rasa penasaran.
4. "highlight_keywords": 3–8 kata kunci terpenting yang diucapkan untuk diwarnai kontras.
5. "pacing_reason": Alasan singkat 1 kalimat bagian mana yang dipangkas untuk menjaga ritme.

OUTPUT HANYA FORMAT JSON VALID:
{
  "drop_cue_ids": ["C2", "C5"],
  "hook_banner_text": "HOOK PUNCHY MAKSIMAL ENAM KATA",
  "highlight_keywords": ["KATA1", "KATA2"],
  "pacing_reason": "Alasan singkat memangkas cue tersebut"
}`;

/**
 * Konversi daftar cueMap dan drop_cue_ids menjadi array cuts: [{ start, end }]
 * dengan buffer 0.15s dan merge segmen aktif jika jarak <= 0.35s.
 */
export function buildCutsFromKeptCues(cueMap, dropCueIds = [], clipDuration, { bufferSec = 0.15, mergeGapSec = 0.35 } = {}) {
  const dropSet = new Set(dropCueIds);
  const keptCues = Object.values(cueMap)
    .filter((c) => !dropSet.has(c.id))
    .sort((a, b) => a.start - b.start);

  if (keptCues.length === 0) {
    return [{ start: 0, end: Number(clipDuration.toFixed(2)) }];
  }

  const rawSegments = keptCues.map((c) => ({
    start: Math.max(0, Number((c.start - bufferSec).toFixed(2))),
    end: Math.min(clipDuration, Number((c.end + bufferSec).toFixed(2))),
  }));

  // Gabungkan (merge) segmen yang tumpang tindih atau berdekatan (gap <= mergeGapSec)
  const merged = [rawSegments[0]];
  for (let i = 1; i < rawSegments.length; i++) {
    const current = rawSegments[i];
    const prev = merged[merged.length - 1];

    if (current.start <= prev.end + mergeGapSec) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged.map((m) => ({
    start: Number(m.start.toFixed(2)),
    end: Number(m.end.toFixed(2)),
  }));
}

/** Hitung total durasi segmen cuts */
export function calculateActiveDuration(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return 0;
  const total = cuts.reduce((sum, c) => sum + Math.max(0, c.end - c.start), 0);
  return Number(total.toFixed(2));
}

/**
 * Sub-Agent Pacing & Cut Semantik dengan Self-Verification Loop (Maks. 2 Iterasi).
 * Memastikan durasi aktif 15s <= duration <= 58s.
 */
export async function determinePacing(formattedCues, cueMap, clipDuration, {
  clipTitle = '',
  baseUrl = process.env.NINEROUTER_BASE_URL,
  apiKey = process.env.NINEROUTER_API_KEY,
  model = process.env.NINEROUTER_MODEL,
  fetchFn = globalThis.fetch,
  fallbackHookText = '',
  fallbackKeywords = [],
} = {}) {
  const fallbackResult = {
    cuts: detectJumpCuts(Object.values(cueMap), clipDuration),
    hook_banner_text: (fallbackHookText || clipTitle || '').toUpperCase(),
    highlight_keywords: fallbackKeywords,
    pacing_reason: 'Fallback auto jump-cut (semantic pacer default).',
    iterations: 0,
  };

  if (!formattedCues || !baseUrl || Object.keys(cueMap).length === 0) {
    return fallbackResult;
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: PACER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Berikut transkrip cue klip "${clipTitle}" (Total durasi asli: ${clipDuration}s):\n\n${formattedCues}\n\nPilihlah drop_cue_ids untuk memotong dead air/filler agar durasi video menjadi ringkas dan padat (maksimal 58 detik).`,
    },
  ];

  let bestResult = null;

  for (let iter = 1; iter <= 2; iter++) {
    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages,
        }),
      });

      if (!res.ok) continue;

      const text = await res.text();
      let content = '';
      try {
        const json = JSON.parse(text);
        content = json.choices?.[0]?.message?.content ?? '';
      } catch {
        content = parseResponseText(text);
      }

      const cleaned = cleanJsonString(content);
      const parsed = JSON.parse(cleaned);
      const validated = pacingSchema.safeParse(parsed);

      if (!validated.success) continue;

      const { drop_cue_ids, hook_banner_text, highlight_keywords, pacing_reason } = validated.data;
      const cuts = buildCutsFromKeptCues(cueMap, drop_cue_ids, clipDuration);
      const activeDuration = calculateActiveDuration(cuts);

      bestResult = {
        cuts,
        hook_banner_text: (hook_banner_text || fallbackHookText || clipTitle).toUpperCase(),
        highlight_keywords: highlight_keywords || fallbackKeywords,
        pacing_reason,
        iterations: iter,
      };

      // Kriteria lolos: antara 15 detik s/d 58 detik
      if (activeDuration >= 15 && activeDuration <= 58) {
        return bestResult;
      }

      // Jika masih > 58 detik pada iterasi 1, kirim feedback untuk iterasi 2
      if (iter === 1 && activeDuration > 58) {
        const excess = Number((activeDuration - 55).toFixed(1));
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `Durasi aktif hasil potongan masih ${activeDuration}s (melebihi batas 58s Shorts/Reels). Pangkas sekitar ${excess}s lagi dengan menambahkan cue ID lain ke drop_cue_ids pada bagian penjelasan yang paling kurang esensial tanpa memotong punchline akhir.`,
        });
      }
    } catch {
      // Loop coba lagi / iterasi 2
    }
  }

  return bestResult || fallbackResult;
}
