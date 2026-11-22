import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultFontsDir = resolve(projectRoot, 'storage/fonts');

export const VIRAL_FONTS = {
  montserrat: {
    key: 'montserrat',
    label: 'Montserrat ExtraBold',
    file: 'Montserrat-ExtraBold.ttf',
    fontName: 'Montserrat ExtraBold',
    cssFamily: "'Montserrat ExtraBold', 'Montserrat', sans-serif",
  },
  poppins: {
    key: 'poppins',
    label: 'Poppins Black',
    file: 'Poppins-Black.ttf',
    fontName: 'Poppins Black',
    cssFamily: "'Poppins Black', 'Poppins', sans-serif",
  },
  anton: {
    key: 'anton',
    label: 'Anton',
    file: 'Anton-Regular.ttf',
    fontName: 'Anton',
    cssFamily: "'Anton', sans-serif",
  },
  bebas: {
    key: 'bebas',
    label: 'Bebas Neue',
    file: 'BebasNeue-Regular.ttf',
    fontName: 'Bebas Neue',
    cssFamily: "'Bebas Neue', sans-serif",
  },
  oswald: {
    key: 'oswald',
    label: 'Oswald Bold',
    file: 'Oswald',
    fontName: 'Oswald',
    cssFamily: "'Oswald', sans-serif",
  },
  jakarta: {
    key: 'jakarta',
    label: 'Plus Jakarta Sans ExtraBold',
    file: 'PlusJakartaSans-ExtraBold.ttf',
    fontName: 'Plus Jakarta Sans ExtraBold',
    cssFamily: "'Plus Jakarta Sans ExtraBold', 'Plus Jakarta Sans', sans-serif",
  },
};

/**
 * Baca tabel 'name' OpenType langsung dari buffer TTF untuk mendapatkan
 * font family name yang dikenali oleh FreeType/libass.
 */
export function readTtfFontName(buf) {
  if (!buf || buf.length < 16) return null;
  const numTables = buf.readUInt16BE(4);
  let nameTableOffset = 0;
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 4 > buf.length) break;
    const tag = buf.toString('utf8', offset, offset + 4);
    if (tag === 'name') {
      nameTableOffset = buf.readUInt32BE(offset + 8);
      break;
    }
  }
  if (!nameTableOffset || nameTableOffset + 6 > buf.length) return null;

  const count = buf.readUInt16BE(nameTableOffset + 2);
  const stringOffset = nameTableOffset + buf.readUInt16BE(nameTableOffset + 4);

  const names = {};
  for (let i = 0; i < count; i++) {
    const recOffset = nameTableOffset + 6 + i * 12;
    if (recOffset + 12 > buf.length) break;
    const platformId = buf.readUInt16BE(recOffset);
    const nameId = buf.readUInt16BE(recOffset + 6);
    const length = buf.readUInt16BE(recOffset + 8);
    const offset = buf.readUInt16BE(recOffset + 10);

    const strOffset = stringOffset + offset;
    if (strOffset + length > buf.length) continue;
    const bytes = buf.subarray(strOffset, strOffset + length);

    let str = '';
    if (platformId === 0 || platformId === 3) {
      str = new TextDecoder('utf-16be').decode(bytes);
    } else {
      str = bytes.toString('utf8');
    }

    if ([1, 4].includes(nameId) && !names[nameId]) {
      names[nameId] = str;
    }
  }

  return names[1] || names[4] || null;
}

/**
 * Resolve fontName ASS berdasarkan fontKey ('anton', 'montserrat', dll).
 */
export function resolveFontName(fontKey, fallback = 'Montserrat ExtraBold') {
  if (!fontKey) return fallback;
  const key = String(fontKey).toLowerCase().trim();
  return VIRAL_FONTS[key]?.fontName || fallback;
}

/**
 * Baca nama font langsung dari disk jika file tersedia, fallback ke resolveFontName.
 */
export async function getFontNameFromFile(fontKey, fontsDir = defaultFontsDir) {
  const key = String(fontKey || '').toLowerCase().trim();
  const meta = VIRAL_FONTS[key];
  if (!meta) return resolveFontName(fontKey);

  try {
    const buf = await readFile(resolve(fontsDir, meta.file));
    const internalName = readTtfFontName(buf);
    return internalName || meta.fontName;
  } catch {
    return meta.fontName;
  }
}
