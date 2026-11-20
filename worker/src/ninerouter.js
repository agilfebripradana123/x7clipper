export class NineRouterError extends Error {
  constructor(msg, status) { super(msg); this.name = 'NineRouterError'; this.status = status; }
}

const SYSTEM_PROMPT = `Kamu adalah AI analis konten video. Tugasmu mencari 1–4 momen paling menarik dari transkrip yang diberikan untuk dijadikan klip pendek (30–75 detik) yang layak viral di TikTok/Reels/Shorts.

ATURAN WAJIB:
1. Output HANYA JSON valid. Tidak boleh ada teks lain di luar JSON.
2. Gunakan HANYA segment ID yang ada di transkrip (format [S{id}|{detik}]). DILARANG KERAS mengarang ID di luar daftar.
3. Setiap klip harus punya hook kuat di awal dan penutup yang tuntas (bukan terpotong).
4. Jika chunk hanya berisi intro, iklan, atau obrolan datar tanpa momen menarik, kembalikan "clips": [].

FORMAT OUTPUT:
{
  "chunk_summary": "Ringkasan 1 kalimat topik chunk ini",
  "clips": [
    {
      "title": "Judul hook singkat max 60 karakter",
      "start_segment_id": "S...",
      "end_segment_id": "S...",
      "viral_score": 1-100,
      "hook_type": "contrarian | story | actionable_tip | emotional | debate",
      "reason": "Alasan singkat kenapa momen ini menarik dan utuh",
      "suggested_caption": "Caption singkat media sosial"
    }
  ]
}`;

/** Bersihkan markdown fence dan teks preamble dari respons LLM. */
export function cleanJsonString(raw) {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Coba ambil JSON object mentah
  const braceMatch = raw.match(/(\{[\s\S]*\})/);
  if (braceMatch) return braceMatch[1].trim();
  return raw.trim();
}

/**
 * Kirim satu chunk transkrip ke 9router dan terima daftar klip.
 * Retry 1x jika JSON invalid.
 */
export async function selectClipsFromChunk(formattedText, {
  baseUrl = process.env.NINEROUTER_BASE_URL,
  apiKey = process.env.NINEROUTER_API_KEY,
  model = process.env.NINEROUTER_MODEL,
  fetchFn = globalThis.fetch,
  maxRetries = 1,
} = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analisis transkrip berikut dan temukan momen terbaik:\n\n${formattedText}` },
    ],
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new NineRouterError(`9router HTTP ${response.status}: ${text}`, response.status);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const cleaned = cleanJsonString(content);

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = new NineRouterError(`JSON parse gagal (attempt ${attempt + 1}): ${err.message}`);
    }
  }

  throw lastError;
}
