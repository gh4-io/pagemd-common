/**
 * A tiny zip reader and writer (phase L2-5), ported from pagemd-library `scripts/lib/zip.mjs` with the same rules and
 * limits: regular files only, deflate or stored, no encryption, no zip64, no multi-disk; limits against zip bombs.
 * Writing is deterministic (entries sorted by name, fixed time and permissions, deflate level 9), so the same files
 * give the same bytes as the library's writer (a test compares them).
 * Node built-ins only: `zlib`; `zlib.crc32` (Node 22+) when present, else a small table CRC-32 (the same numbers).
 */

import zlib from 'node:zlib';

const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01
const UNIX_FILE_MODE = 0o100644;

let table = null;
/** CRC-32 (IEEE), as zlib.crc32. */
export function crc32Fallback(data) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const crc32 = typeof zlib.crc32 === 'function' ? (data) => zlib.crc32(data) >>> 0 : crc32Fallback;

/** @param {{name: string, data: Buffer}[]} entries -> Buffer */
export function writeZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    let body = zlib.deflateRawSync(data, { level: 9 });
    let method = 8;
    if (body.length >= data.length) { body = data; method = 0; }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(((UNIX_FILE_MODE << 16) >>> 0), 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export class ZipError extends Error {}

/** The reader's limits (the library's). */
export const ZIP_LIMITS = Object.freeze({ maxEntries: 2000, maxTotal: 64 * 1024 * 1024 });

/**
 * Read every entry of a zip. Throws ZipError on anything it does not support or that looks wrong.
 * Returns [{name, data, mode, isDir}]. It does not judge names (see rules.js).
 */
export function readZip(buf, { maxEntries = ZIP_LIMITS.maxEntries, maxTotal = ZIP_LIMITS.maxTotal } = {}) {
  if (buf.length < 22) throw new ZipError('not a zip file (too short)');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not a zip file (no end record)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) throw new ZipError('multi-disk zips are not supported');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('zip64 is not supported');
  if (count > maxEntries) throw new ZipError(`too many entries (${count} > ${maxEntries})`);
  if (cdOffset + cdSize > eocd) throw new ZipError('the central directory is out of range');
  const out = [];
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('damaged central directory');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw new ZipError(`${name}: encrypted entries are not supported`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError(`${name}: zip64 is not supported`);
    const host = madeBy >> 8;
    const mode = host === 3 ? (ext >>> 16) : 0;
    const type = mode & 0o170000;
    const isDir = name.endsWith('/') || type === 0o040000;
    if (host === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      throw new ZipError(`${name}: not a regular file (symbolic link or special file)`);
    }
    total += usize;
    if (total > maxTotal) throw new ZipError(`unpacked size is over ${maxTotal} bytes`);
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new ZipError(`${name}: damaged local header`);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lxlen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lxlen;
    if (start + csize > buf.length) throw new ZipError(`${name}: data out of range`);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) }); } catch (e) { throw new ZipError(`${name}: cannot inflate (${e.message})`); }
    } else throw new ZipError(`${name}: compression method ${method} is not supported`);
    if (data.length !== usize) throw new ZipError(`${name}: size does not match the header`);
    if (crc32(data) !== crc) throw new ZipError(`${name}: CRC check failed`);
    out.push({ name, data, mode, isDir });
  }
  return out;
}
