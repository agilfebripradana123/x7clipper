import test from 'node:test';
import assert from 'node:assert/strict';
import { determineFraming } from '../src/agents/visionFramer.js';

test('determineFraming parsing respons vision sukses dengan layout dan crop_x', async () => {
  const fakeResponse = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            layout_mode: 'blur_bg',
            crop_x: 0.35,
            framing_reason: 'Terlihat presentasi slide dan pembicara di sisi kiri.',
          }),
        },
      },
    ],
  };

  const fetchFn = async () => ({
    ok: true,
    text: async () => JSON.stringify(fakeResponse),
  });

  const result = await determineFraming(['data:image/jpeg;base64,123'], 'Judul Klip', {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'secret',
    visionModel: 'vision-model',
    fetchFn,
  });

  assert.equal(result.layout_mode, 'blur_bg');
  assert.equal(result.crop_x, 0.35);
  assert.ok(result.framing_reason.includes('slide'));
});

test('determineFraming fallback otomatis jika API error (400 / 500) tanpa throw', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Model does not support images',
  });

  const result = await determineFraming(['data:image/jpeg;base64,123'], 'Judul', {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'secret',
    visionModel: 'vision-model',
    fetchFn,
    fallbackLayout: 'full_crop',
    fallbackCropX: 0.5,
  });

  assert.equal(result.layout_mode, 'full_crop');
  assert.equal(result.crop_x, 0.5);
  assert.ok(result.framing_reason.includes('Fallback'));
});

test('determineFraming fallback jika framesBase64 kosong', async () => {
  const result = await determineFraming([], 'Judul', {
    fallbackLayout: 'blur_bg',
    fallbackCropX: 0.7,
  });

  assert.equal(result.layout_mode, 'blur_bg');
  assert.equal(result.crop_x, 0.7);
});
