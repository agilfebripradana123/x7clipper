import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const required = ['NINEROUTER_BASE_URL', 'NINEROUTER_API_KEY', 'NINEROUTER_MODEL'];
const binaryChecks = [
  ['yt-dlp', process.env.YTDLP_PATH ?? 'yt-dlp', ['--version']],
  ['ffmpeg', process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']],
  ['ffprobe', process.env.FFPROBE_PATH ?? 'ffprobe', ['-version']],
];
let failed = false;

async function check(name, run) {
  try {
    const message = await run();
    console.log(`PASS ${name}${message ? `: ${message}` : ''}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

for (const [name, command, args] of binaryChecks) {
  await check(name, async () => {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10_000 });
    return (stdout || stderr).trim().split(/\r?\n/)[0];
  });
}

await check('Redis', async () => {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    return await redis.ping();
  } finally {
    redis.disconnect();
  }
});

await check('9router configuration', async () => {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
  return 'configured';
});

if (process.env.NINEROUTER_HEALTHCHECK === 'true') {
  await check('9router request', async () => {
    const baseUrl = process.env.NINEROUTER_BASE_URL.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${process.env.NINEROUTER_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return 'reachable';
  });
} else {
  console.log('SKIP 9router request: set NINEROUTER_HEALTHCHECK=true after configuring .env');
}

if (failed) process.exitCode = 1;
