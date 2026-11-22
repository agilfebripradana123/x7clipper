export class NineRouterError extends Error {
  constructor(msg, status) { super(msg); this.name = 'NineRouterError'; this.status = status; }
}

const SYSTEM_PROMPT = `Kamu adalah AI analis konten video dan Auto-Editor profesional. Tugasmu mencari 1–4 momen cerita atau pembahasan paling menarik dari transkrip yang diberikan yang utuh dan tuntas sesuai konteks (berapapun durasinya, baik pendek puluhan detik maupun panjang beberapa menit; dilarang memotong pembicaraan di tengah konteks demi mengejar batas durasi), sekaligus menyusun editorial plan visualnya.

ATURAN WAJIB:
1. Output HANYA JSON valid. Tidak boleh ada teks lain di luar JSON.
2. Gunakan HANYA segment ID yang ada di transkrip (format [S{id}|{detik}]). DILARANG KERAS mengarang ID di luar daftar.
3. Setiap klip harus punya hook kuat di awal dan penutup yang tuntas sesuai konteks pembahasan (bukan terpotong).
4. Jika chunk hanya berisi intro, iklan, atau obrolan datar tanpa momen menarik, kembalikan "clips": [].
5. Untuk setiap klip, buat editorial plan pada "auto_edit":
   - "hook_banner_text": Judul hook punchy maksimal 6 kata (KAPITAL SEMUA) untuk banner atas video.
   - "recommended_layout": "full_crop" (fokus 1 orang/reaksi tajam) atau "blur_bg" (jika konten lebar/grafik/banyak orang).
   - "highlight_keywords": array 3–8 kata kunci penting dari klip tersebut untuk di-highlight warna kontras.

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
      "suggested_caption": "Caption singkat media sosial",
      "auto_edit": {
        "hook_banner_text": "HOOK PUNCHY MAKSIMAL ENAM KATA",
        "recommended_layout": "full_crop | blur_bg",
        "highlight_keywords": ["KATA1", "KATA2"]
      }
    }
  ]
}`;

export function cleanJsonString(raw) {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceMatch = raw.match(/(\{[\s\S]*\})/);
  if (braceMatch) return braceMatch[1].trim();
  return raw.trim();
}

/** Parse teks respons: handle jika server mengembalikan Server-Sent Events (SSE) data: {...} */
export function parseResponseText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('data:')) {
    const data = JSON.parse(trimmed);
    return data.choices?.[0]?.message?.content ?? '';
  }

  // Akumulasi streaming SSE chunk
  let fullContent = '';
  for (const line of trimmed.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
      fullContent += delta;
    } catch { /* skip chunk malform */ }
  }
  return fullContent;
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
    stream: false,
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

    // 9router kadang balas SSE walau stream:false, jadi jangan percaya content-type.
    const text = await response.text();
    let content;
    try {
      const data = JSON.parse(text);
      content = data.choices?.[0]?.message?.content ?? '';
    } catch {
      content = parseResponseText(text);
    }
    if (content.trim().startsWith('data:')) content = parseResponseText(content);
    const cleaned = cleanJsonString(content);

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = new NineRouterError(`JSON parse gagal (attempt ${attempt + 1}): ${err.message}`);
    }
  }

  throw lastError;
}
