import { z } from 'zod';
import { cleanJsonString, parseResponseText } from '../ninerouter.js';

const framingSchema = z.object({
  layout_mode: z.enum(['full_crop', 'blur_bg']),
  crop_x: z.number().min(0).max(1),
  framing_reason: z.string().min(1),
});

const VISION_SYSTEM_PROMPT = `Kamu adalah Video Framing Director untuk konten vertikal 9:16 (TikTok, Reels, Shorts).
Tugasmu menganalisis 3 frame contoh dari video landscape 16:9 dan menentukan framing terbaik untuk crop 9:16.

PANDUAN KEPUTUSAN:
1. "layout_mode":
   - "full_crop": Jika hanya ada 1 orang/pembicara tunggal, wajah terpusat, atau objek fokus jelas yang pas di area vertikal.
   - "blur_bg": Jika terlihat 2 orang atau lebih berjauhan, wawancara dua sisi, screen-share, slide presentasi, kode programming, atau visual penting melebar yang akan terpotong rusak jika di-crop penuh.
2. "crop_x":
   - Angka float antara 0.0 (paling kiri) sampai 1.0 (paling kanan) untuk titik tengah crop vertikal.
   - Default adalah 0.5 (tengah). Jika subjek condong ke kiri beri nilai < 0.5 (misal 0.25). Jika ke kanan beri nilai > 0.5 (misal 0.75).
3. "framing_reason":
   - Penjelasan singkat 1 kalimat alasan pemilihan layout dan posisi crop.

OUTPUT HANYA FORMAT JSON VALID:
{
  "layout_mode": "full_crop | blur_bg",
  "crop_x": 0.5,
  "framing_reason": "Alasan singkat 1 kalimat"
}`;

/**
 * Panggil 9router vision completions dengan 3 frame gambar base64.
 * Resiliensi penuh: Jika API error / tidak mendukung gambar, fallback otomatis tanpa throw.
 */
export async function determineFraming(framesBase64, clipTitle = '', {
  baseUrl = process.env.NINEROUTER_BASE_URL,
  apiKey = process.env.NINEROUTER_API_KEY,
  visionModel = process.env.NINEROUTER_VISION_MODEL || process.env.NINEROUTER_MODEL,
  fetchFn = globalThis.fetch,
  fallbackLayout = 'full_crop',
  fallbackCropX = 0.5,
} = {}) {
  const defaultFallback = (errMsg = null) => ({
    layout_mode: fallbackLayout === 'blur_bg' ? 'blur_bg' : 'full_crop',
    crop_x: Math.min(1, Math.max(0, Number(fallbackCropX) || 0.5)),
    framing_reason: errMsg
      ? `Fallback (Vision 9router gagal: ${errMsg})`
      : 'Fallback default (vision framing skipped atau tidak tersedia).',
  });

  if (!Array.isArray(framesBase64) || framesBase64.length === 0 || !baseUrl) {
    return defaultFallback();
  }

  const userContent = [
    {
      type: 'text',
      text: `Analisis 3 frame berikut untuk video berjudul "${clipTitle}". Tentukan layout_mode (full_crop / blur_bg) dan posisi crop_x (0.0 - 1.0).`,
    },
    ...framesBase64.map((b64) => ({
      type: 'image_url',
      image_url: { url: b64 },
    })),
  ];

  const payload = {
    model: visionModel,
    stream: false,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  let lastErrorMsg = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastErrorMsg = `HTTP ${res.status} ${errText.slice(0, 80)}`.trim();
        continue;
      }

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
      const validated = framingSchema.safeParse(parsed);

      if (validated.success) {
        return {
          layout_mode: validated.data.layout_mode,
          crop_x: Math.min(1, Math.max(0, validated.data.crop_x)),
          framing_reason: validated.data.framing_reason,
        };
      } else {
        lastErrorMsg = 'Format output AI tidak valid';
      }
    } catch (err) {
      lastErrorMsg = err?.message || 'Koneksi gagal';
    }
  }

  return defaultFallback(lastErrorMsg);
}
