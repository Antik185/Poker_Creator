'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const output = path.join(__dirname, '..', 'public', 'assets', 'reactions', 'cat-thief');
const sprites = {
  'cat-head-front': [60, 16, 294, 254],
  'cat-head-left': [404, 18, 297, 254],
  'cat-head-right': [757, 19, 298, 254],
  'cat-body': [88, 543, 266, 151],
  'cat-paw-hold': [475, 391, 120, 85],
  'cat-paw-reach': [837, 374, 197, 115],
  'cat-paw-grab': [1106, 339, 205, 136],
  'cat-tail': [426, 520, 118, 174],
  'cat-chip': [828, 543, 142, 138],
  'cat-smile': [1036, 574, 118, 94]
};

// Keep the grip and its dark edge, but not the precomposed chip beneath it.
const grabMask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="205" height="136"><path d="M0 0H205V64L180 67Q172 79 154 77Q140 85 124 78Q107 85 93 74Q78 82 71 104L66 136H0Z" fill="white"/></svg>');

async function main(source) {
  if (!source) throw new Error('Usage: node tools/prepare-cat-thief-sprites.js <source sprite sheet PNG>');
  const input = sharp(source);
  const { width, height, hasAlpha } = await input.metadata();
  if (width !== 1448 || height !== 1086 || !hasAlpha) throw new Error('Expected the original 1448x1086 sheet with alpha');
  await fs.mkdir(output, { recursive: true });
  for (const [id, [left, top, w, h]] of Object.entries(sprites)) {
    const data = await input.clone().extract({ left, top, width: w, height: h }).raw().toBuffer();
    // The source has a faint alpha haze outside the contours. Keep feathering on the actual outline.
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(255 * Math.min(1, Math.max(0, (data[i] - 55) / 117)));
    let sprite = sharp(data, { raw: { width: w, height: h, channels: 4 } });
    if (id === 'cat-paw-grab') sprite = sharp(await sprite.composite([{ input: grabMask, blend: 'dest-in' }]).png().toBuffer());
    await sprite.resize({ width: 220, withoutEnlargement: true }).webp({ quality: 87, alphaQuality: 98 }).toFile(path.join(output, id + '.webp'));
  }
}

main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
