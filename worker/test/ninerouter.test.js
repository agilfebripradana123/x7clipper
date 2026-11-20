import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJsonString, parseResponseText, selectClipsFromChunk, NineRouterError } from '../src/ninerouter.js';

test('cleanJsonString bersihkan code fence markdown dan whitespace', () => {
  const fenced = '```json\n{"chunk_summary":"topik","clips":[]}\n```';
  assert.equal(cleanJsonString(fenced), '{"chunk_summary":"topik","clips":[]}');

  const withPreamble = 'Berikut hasil analisis:\n```\n{"chunk_summary":"topik","clips":[]}\n```\nSemoga membantu!';
  assert.equal(cleanJsonString(withPreamble), '{"chunk_summary":"topik","clips":[]}');
});

test('parseResponseText gabungkan chunk Server-Sent Events', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"{\\\"chunk_"}}]}',
    'data: {"choices":[{"delta":{"content":"summary\\\":\\\"ok\\\",\\\"clips\\\":[]}"}}]}',
    'data: [DONE]',
  ].join('\n');
  assert.equal(parseResponseText(sse), '{"chunk_summary":"ok","clips":[]}');
});

test('selectClipsFromChunk kirim payload valid ke endpoint 9router', async () => {
  let capturedBody;
  let capturedHeaders;

  const mockFetch = async (url, options) => {
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                chunk_summary: 'Diskusi seputar masa depan AI',
                clips: [
                  {
                    title: 'AI Akan Menggantikan Programmer?',
                    start_segment_id: 'S1',
                    end_segment_id: 'S5',
                    viral_score: 92,
                    hook_type: 'contrarian',
                    reason: 'Topik memicu perdebatan dan argumen lengkap',
                    suggested_caption: 'Apakah software engineer akan punah?',
                  },
                ],
              }),
            },
          },
        ],
      }),
    };
  };

  const result = await selectClipsFromChunk('[S1|0] Halo\n[S5|25] Selesai', {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'sk-test',
    model: 'custom-model',
    fetchFn: mockFetch,
  });

  assert.equal(result.chunk_summary, 'Diskusi seputar masa depan AI');
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].start_segment_id, 'S1');
  assert.equal(capturedHeaders.Authorization, 'Bearer sk-test');
  assert.equal(capturedBody.model, 'custom-model');
  assert.equal(capturedBody.temperature, 0.2);
  assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
});

test('retry 1x otomatis jika respon pertama invalid JSON', async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts === 1) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'Bukan json sama sekali' } }],
        }),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{"chunk_summary":"sukses retry","clips":[]}\n```',
            },
          },
        ],
      }),
    };
  };

  const result = await selectClipsFromChunk('[S1|0] teks', {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'sk-test',
    model: 'model',
    fetchFn: mockFetch,
  });

  assert.equal(attempts, 2);
  assert.equal(result.chunk_summary, 'sukses retry');
});

test('lempar NineRouterError jika API mengembalikan HTTP error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized API key',
  });

  await assert.rejects(
    () => selectClipsFromChunk('[S1|0] teks', {
      baseUrl: 'https://api.9router.com/v1',
      apiKey: 'bad-key',
      model: 'model',
      fetchFn: mockFetch,
    }),
    NineRouterError
  );
});
