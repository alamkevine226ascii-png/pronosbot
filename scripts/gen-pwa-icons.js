/**
 * Generation des icônes PWA depuis logo-source.jpeg (image utilisateur)
 */
const sharp = require('sharp');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const SRC = path.join(PUB, 'logo-source.jpeg');
const BG_DARK = '#0a0a0a';

async function makeIcon(size, opts = {}) {
  const { maskable = false, suffix = '' } = opts;
  const scale = maskable ? 0.80 : 1.0;
  const logoSize = Math.round(size * scale);
  const offset = Math.round((size - logoSize) / 2);
  const imgBuf = await sharp(SRC)
    .resize(logoSize, logoSize, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const out = path.join(PUB, `icon-${size}${suffix}.png`);
  if (scale >= 1.0) {
    await sharp(imgBuf).resize(size, size, { fit: 'cover' }).png().toFile(out);
  } else {
    await sharp({ create: { width: size, height: size, channels: 4, background: BG_DARK } })
      .composite([{ input: imgBuf, left: offset, top: offset }])
      .png()
      .toFile(out);
  }
  console.log(`OK  ${path.basename(out)}  (${size}x${size}${maskable ? ' maskable' : ''})`);
}

async function main() {
  console.log('Generation des icones PWA...\n');
  await makeIcon(192);
  await makeIcon(512);
  await makeIcon(192, { maskable: true, suffix: '-maskable' });
  await makeIcon(512, { maskable: true, suffix: '-maskable' });
  // apple-touch-icon 180x180 iOS (fond opaque)
  await sharp(SRC).resize(180, 180, { fit: 'cover', position: 'centre' }).flatten({ background: BG_DARK }).png().toFile(path.join(PUB, 'apple-touch-icon.png'));
  console.log('OK  apple-touch-icon.png  (180x180 iOS)');
  // favicons
  await sharp(SRC).resize(32, 32, { fit: 'cover' }).png().toFile(path.join(PUB, 'favicon-32.png'));
  await sharp(SRC).resize(16, 16, { fit: 'cover' }).png().toFile(path.join(PUB, 'favicon-16.png'));
  console.log('OK  favicon-32.png, favicon-16.png');
  await sharp(path.join(PUB, 'favicon-32.png')).toFile(path.join(PUB, 'favicon.ico'));
  console.log('OK  favicon.ico');
  await sharp(SRC).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(PUB, 'logo.png'));
  console.log('OK  logo.png');
  console.log('\nTermine.');
}

main().catch((e) => { console.error(e); process.exit(1); });
