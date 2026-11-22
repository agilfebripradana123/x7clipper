import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildArgs,
  buildFilters,
  escapeFilterPath,
  outputDimensions,
  parseProgressPercent,
  renderClip,
  trimRange,
} from '../src/renderer.js';

const CLIP = {
  id: 5,
  start_sec: 10,
  end_sec: 40,
  raw_clip_path: 'D:\\storage\\raw-clips\\clip-5.mp4',
};

test('outputDimensions: mendukung 9:16, 1:1, 4:3, 16:9', () => {
  assert.deepEqual(outputDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(outputDimensions('1:1'), { width: 1080, height: 1080 });
  assert.deepEqual(outputDimensions('4:3'), { width: 1440, height: 1080 });
  assert.deepEqual(outputDimensions('16:9'), { width: 1920, height: 1080 });
});

test('buildFilters memotong horizontal berdasarkan crop_x untuk 9:16, 1:1, dan 4:3', () => {
  const f916 = buildFilters({ aspectRatio: '9:16', cropX: 0.25 });
  assert.ok(f916.includes("crop=w='trunc(ih*9/32)*2'"));
  assert.ok(f916.includes("x='trunc((iw-ih*9/16)*0.25)'"));
  assert.ok(f916.includes('scale=1080:1920'));

  const f11 = buildFilters({ aspectRatio: '1:1', cropX: 0.5 });
  assert.ok(f11.includes('crop=w=ih:h=ih:x=\'trunc((iw-ih)*0.5)\''));
  assert.ok(f11.includes('scale=1080:1080'));

  const f43 = buildFilters({ aspectRatio: '4:3', cropX: 0.75 });
  assert.ok(f43.includes("crop=w='trunc(ih*2/3)*2'"));
  assert.ok(f43.includes("x='trunc((iw-ih*4/3)*0.75)'"));
  assert.ok(f43.includes('scale=1440:1080'));
});

test('buildFilters mode blur membuat stack background blur dengan gblur dan eq brightness', () => {
  const filter = buildFilters({ aspectRatio: '9:16', layoutMode: 'blur_bg' });
  assert.ok(filter.includes('split=2[bg][fg]'));
  assert.ok(filter.includes('gblur=sigma=35'));
  assert.ok(filter.includes('eq=brightness=-0.12'));
  assert.ok(filter.includes('overlay=(W-w)/2:(H-h)/2'));
});

test('buildFilters 16:9 letterbox dan escape path Windows untuk subtitle', () => {
  const filter = buildFilters({
    aspectRatio: '16:9',
    assPath: 'D:\\PORTO\\web\\storage\\tmp\\clip-5.ass',
    fontsDir: 'D:\\PORTO\\web\\storage\\fonts',
  });

  assert.ok(filter.startsWith('scale=1920:1080:force_original_aspect_ratio=decrease'));
  assert.ok(filter.includes("subtitles=filename='D\\:/PORTO/web/storage/tmp/clip-5.ass'"));
  assert.ok(filter.includes("fontsdir='D\\:/PORTO/web/storage/fonts'"));
  assert.equal(escapeFilterPath("C:\\a b\\x's.ass"), "C\\:/a b/x\\'s.ass");
});

test('parseProgressPercent membaca out_time_ms dan out_time', () => {
  assert.equal(parseProgressPercent('out_time_ms=15000000', 30), 50);
  assert.equal(parseProgressPercent('out_time_us=30000000', 30), 100);
  assert.equal(parseProgressPercent('out_time=00:00:15.000000', 30), 50);
  assert.equal(parseProgressPercent('out_time_ms=999999999', 30), 100);
  assert.equal(parseProgressPercent('frame=120', 30), null);
  assert.equal(parseProgressPercent('out_time_ms=1000', 0), null);
});

test('trimRange memakai config dan menolak rentang terbalik', () => {
  assert.deepEqual(trimRange({ trim_start: 2.5, trim_end: 18 }, 30), { start: 2.5, end: 18 });
  assert.deepEqual(trimRange({}, 30), { start: 0, end: 30 });
  assert.throws(() => trimRange({ trim_start: 10, trim_end: 5 }, 30), /Rentang trim tidak valid/);
});

test('buildArgs memuat trim, filter, codec, dan progress pipe', () => {
  const args = buildArgs({
    rawClipPath: CLIP.raw_clip_path,
    outputPath: 'out.mp4',
    config: { trim_start: 1.5, trim_end: 11.5, aspect_ratio: '9:16', crop_x: 0.5 },
    durationSec: 30,
  });

  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '1.5']);
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '10']);
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-crf') + 1], '18');
  assert.equal(args[args.indexOf('-af') + 1], 'loudnorm=I=-14:TP=-1.5:LRA=11');
  assert.equal(args[args.indexOf('-progress') + 1], 'pipe:1');
  assert.equal(args.at(-1), 'out.mp4');
});

test('buildArgs multi-cut membuat concat trim filter kompleks', () => {
  const args = buildArgs({
    rawClipPath: CLIP.raw_clip_path,
    outputPath: 'out.mp4',
    config: {
      cuts: [
        { start: 2, end: 6 },
        { start: 10, end: 15 },
      ],
      aspectRatio: '9:16',
      cropX: 0.5,
    },
    durationSec: 30,
  });

  assert.ok(args.includes('-filter_complex'));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.ok(fc.includes('trim=start=2:end=6'));
  assert.ok(fc.includes('trim=start=10:end=15'));
  assert.ok(fc.includes('concat=n=2:v=1:a=1'));
  assert.ok(args.includes('-map'));
  assert.equal(args[args.indexOf('-map') + 1], '[outa]');
});

function fakeSpawn({ stdout = [], stderr = '', code = 0 }) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      for (const line of stdout) child.stdout.emit('data', Buffer.from(`${line}\n`));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  };
}

test('renderClip menulis ASS, menjalankan ffmpeg, dan melaporkan progres', async () => {
  const written = [];
  const progress = [];
  const childScripts = [];

  const result = await renderClip({
    clip: CLIP,
    renderJobId: 9,
    config: {
      trim_start: 0,
      trim_end: 10,
      aspect_ratio: '9:16',
      crop_x: 0.5,
      subtitle: { enabled: true, position: 'top', font_size: 40, color: '#FFE066' },
    },
    subtitles: [{ start: 0, end: 2, text: 'Halo' }],
    outputDir: 'D:\\temp\\exports',
    tempDir: 'D:\\temp\\tmp',
    makeDir: async () => {},
    write: async (path, content) => written.push({ path, content }),
    remove: async () => {},
    spawnFn: fakeSpawn({ stdout: ['out_time_ms=5000000', 'progress=continue', 'out_time_ms=10000000'] }),
    onProgress: (percent) => progress.push(percent),
    ffmpeg: 'ffmpeg',
    argvRecorder: childScripts,
  });

  assert.equal(written.length, 1);
  assert.ok(written[0].path.endsWith('clip-5-render-9.ass'));
  assert.ok(written[0].content.includes('PlayResX: 1080'));
  assert.ok(written[0].content.includes('Alignment,2') === false);
  assert.ok(written[0].content.includes(',8,20,20,160,1'));
  assert.ok(written[0].content.includes('&H0066E0FF'));
  assert.deepEqual(progress, [50, 100]);
  assert.ok(result.outputPath.endsWith('clip-5-render-9.mp4'));
  assert.ok(result.outputUrl.endsWith('clip-5-render-9.mp4'));
  assert.equal(result.durationSec, 10);
});

test('renderClip dengan hook_banner bebas artefak 12)} dan aman terhadap karakter spesial', async () => {
  const written = [];

  await renderClip({
    clip: CLIP,
    renderJobId: 99,
    config: {
      trim_start: 0,
      trim_end: 10,
      aspect_ratio: '9:16',
      subtitle_position: 'top',
      hook_banner: {
        enabled: true,
        text: "KUTIP: 'HOOK' %VIRAL% & {TEST:123} \\N \\pos(100,200)",
      },
      subtitle: { enabled: true, position: 'top', font_size: 40, color: '#FFFFFF' },
    },
    subtitles: [{ start: 0, end: 3, text: "SUBTITLE {RUSAK} \\pos(50,50) 'TEST': 100%" }],
    outputDir: 'D:\\temp\\exports',
    tempDir: 'D:\\temp\\tmp',
    makeDir: async () => {},
    write: async (path, content) => written.push({ path, content }),
    remove: async () => {},
    spawnFn: fakeSpawn({ stdout: ['out_time_ms=10000000'] }),
  });

  const assText = written[0].content;
  // Pastikan tidak ada artefak "12)}" atau kurung kurawal bocor
  assert.ok(!assText.includes('12)}'));
  assert.ok(!assText.includes('{TEST'));
  assert.ok(!assText.includes('\\pos('));
  // Style top dengan banner harus memiliki MarginV 340
  assert.ok(assText.includes(',8,20,20,340,1'));
});

test('renderClip membedakan Fontname antara hook_font dan subtitle_font serta escape fontsdir Windows', async () => {
  const written = [];
  const oldFont = process.env.SUBTITLE_FONT;
  delete process.env.SUBTITLE_FONT;

  try {
    await renderClip({
      clip: CLIP,
      renderJobId: 101,
      config: {
        trim_start: 0,
        trim_end: 5,
        aspect_ratio: '9:16',
        hook_font: 'anton',
        subtitle_font: 'poppins',
        hook_banner: { enabled: true, text: 'BANNER ANTON' },
        subtitle: { enabled: true, position: 'bottom', font_size: 64, color: '#FFFFFF' },
      },
      subtitles: [{ start: 0, end: 2, text: 'SUBTITLE POPPINS' }],
      outputDir: 'D:\\temp\\exports',
      tempDir: 'D:\\temp\\tmp',
      makeDir: async () => {},
      write: async (path, content) => written.push({ path, content }),
      remove: async () => {},
      spawnFn: fakeSpawn({ stdout: ['out_time_ms=5000000'] }),
    });

    const ass = written[0].content;
    assert.ok(ass.includes('Style: Default,Poppins Black,64'));
    assert.ok(ass.includes('Style: Banner,Anton,54'));

    // Verifikasi escaping fontsdir Windows D:\... -> D\:/...
    const filter = buildFilters({
      aspectRatio: '9:16',
      assPath: 'D:\\storage\\tmp\\test.ass',
      fontsDir: 'D:\\storage\\fonts',
    });
    assert.ok(filter.includes("fontsdir='D\\:/storage/fonts'"));
  } finally {
    if (oldFont !== undefined) process.env.SUBTITLE_FONT = oldFont;
  }
});

test('renderClip tanpa subtitle tidak menulis ASS', async () => {
  const written = [];

  await renderClip({
    clip: CLIP,
    renderJobId: 10,
    config: { aspect_ratio: '16:9', subtitle: { enabled: false } },
    subtitles: [{ start: 0, end: 2, text: 'Halo' }],
    outputDir: 'D:\\temp\\exports',
    tempDir: 'D:\\temp\\tmp',
    makeDir: async () => {},
    write: async (...args) => written.push(args),
    remove: async () => {},
    spawnFn: fakeSpawn({ stdout: ['out_time_ms=30000000'] }),
  });

  assert.equal(written.length, 0);
});

test('renderClip melempar error saat ffmpeg exit non-zero', async () => {
  await assert.rejects(
    renderClip({
      clip: CLIP,
      renderJobId: 11,
      config: { aspect_ratio: '16:9' },
      subtitles: [],
      outputDir: 'D:\\temp\\exports',
      tempDir: 'D:\\temp\\tmp',
      makeDir: async () => {},
      write: async () => {},
      remove: async () => {},
      spawnFn: fakeSpawn({ stderr: 'Invalid argument', code: 1 }),
    }),
    /FFmpeg gagal \(exit 1\): Invalid argument/,
  );
});
