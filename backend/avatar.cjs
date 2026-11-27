'use strict';

const sharp = require('sharp');

const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_PROFILE_BODY = 4 * Math.ceil(MAX_AVATAR_BYTES / 3) + 4096;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 8_388_608;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let activeDecodes = 0;
class AvatarBusyError extends Error {}

function staticPng(bytes) {
  if (!bytes.subarray(0, 16).equals(PNG_SIGNATURE)) return false;
  let hasImageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    offset += length + 12;
    if (offset > bytes.length || ['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
    if (type === 'IDAT' && length > 0) hasImageData = true;
    if (type === 'IEND') return hasImageData && length === 0 && offset === bytes.length;
  }
  return false;
}

function staticWebp(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && (bytes[offset + 8] & 2))) return false;
    offset += 8 + size + (size % 2);
  }
  return offset === bytes.length;
}

async function normalizeAvatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('https://')) {
    if (value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) return undefined;
    try {
      const url = new URL(value);
      if (url.hostname && !url.username && !url.password
          && !/\.svgz?$/i.test(decodeURIComponent(url.pathname))) return value;
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (value.length > MAX_PROFILE_BODY) return undefined;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value || match[2].length % 4 !== 0) return undefined;
  const [, type, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== encoded) return undefined;
  if (type === 'png' && !staticPng(bytes)) return undefined;
  if (type === 'jpeg' && (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8
      || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)) return undefined;
  if (type === 'webp' && !staticWebp(bytes)) return undefined;
  if (activeDecodes >= 2) throw new AvatarBusyError();
  activeDecodes++;
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS });
    const { format, width, height, pages } = await image.metadata();
    if (format !== type || !width || !height || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE
        || width * height > MAX_IMAGE_PIXELS || (pages ?? 1) !== 1) return undefined;
    const resized = await image.autoOrient().resize(256, 256, {
      fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: false,
    }).webp().toBuffer();
    return 'data:image/webp;base64,' + resized.toString('base64');
  } catch {
    return undefined;
  } finally {
    activeDecodes--;
  }
}

module.exports = { AvatarBusyError, MAX_PROFILE_BODY, normalizeAvatar };
