import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { crc32, createDeflateRaw, createInflateRaw, deflateRaw } from 'node:zlib';

const deflateRawAsync = promisify(deflateRaw);
import { AppError } from '@rl/core';

/**
 * Minimal streaming zip container for `.rlbackup` files (D-265). Compression is node:zlib (raw deflate, off the main
 * thread); the container is written here because fflate's `Zip` has no Zip64 and a backup can hold more than 65 535
 * files. Entries are written with a data descriptor (sizes are known only after the stream) and the central directory
 * comes last, so a backup is one forward pass; the reader finds everything through the central directory and never
 * loads an entry whole (except the manifest, which has a size limit).
 */

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const U32 = 0xffffffff;
const U16 = 0xffff;
/** Bit 3: data descriptor, bit 11: UTF-8 names. */
const FLAGS = 0x0808;
/** Largest central directory read (entries are capped too; this stops a hostile file from asking for memory). */
const MAX_CENTRAL_BYTES = 256 * 1024 * 1024;

const notABackup = (why: string) => new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why });

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

interface Written {
  name: Buffer;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private pos = 0;
  private readonly written: Written[] = [];

  private constructor(private readonly fh: FileHandle) {}

  /** Creates the file exclusively ('wx': never overwrites; the caller picks a fresh temporary name). */
  static async create(file: string): Promise<ZipWriter> {
    return new ZipWriter(await open(file, 'wx'));
  }

  private async put(buf: Buffer): Promise<void> {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await this.fh.write(buf, off, buf.length - off, this.pos + off);
      off += bytesWritten;
    }
    this.pos += buf.length;
  }

  get count(): number {
    return this.written.length;
  }

  private async begin(name: string): Promise<Written> {
    const nameBytes = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(new Date());
    const e: Written = { name: nameBytes, crc: 0, csize: 0, usize: 0, offset: this.pos, time, date };
    const h = Buffer.alloc(30);
    h.writeUInt32LE(SIG_LOCAL, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(FLAGS, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt16LE(nameBytes.length, 26);
    await this.put(Buffer.concat([h, nameBytes]));
    return e;
  }

  private async end(e: Written): Promise<void> {
    if (e.usize >= U32 || e.csize >= U32) throw new AppError('CONFLICT', 'A file is too large for a backup', { reason: 'too-large' });
    const d = Buffer.alloc(16);
    d.writeUInt32LE(SIG_DESCRIPTOR, 0);
    d.writeUInt32LE(e.crc, 4);
    d.writeUInt32LE(e.csize, 8);
    d.writeUInt32LE(e.usize, 12);
    await this.put(d);
    this.written.push(e);
  }

  /** Adds an entry from a stream (large files: constant memory); returns its size and SHA-256. `onChunk` sees the bytes read (progress). */
  async addStream(name: string, source: Readable, opts: { signal?: AbortSignal | undefined; onChunk?: (n: number) => void } = {}): Promise<{ size: number; sha256: string }> {
    const e = await this.begin(name);
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        e.crc = crc32(chunk, e.crc);
        e.usize += chunk.length;
        opts.onChunk?.(chunk.length);
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        e.csize += chunk.length;
        this.put(chunk).then(() => cb(), cb);
      },
    });
    await pipeline(source, tap, createDeflateRaw({ level: 6 }), sink, opts.signal ? { signal: opts.signal } : {});
    await this.end(e);
    return { size: e.usize, sha256: hash.digest('hex') };
  }

  /** Adds an entry held in memory (small files: no stream machinery, the deflate runs in the thread pool). */
  async addBuffer(name: string, data: Buffer): Promise<{ size: number; sha256: string }> {
    const e = await this.begin(name);
    const packed = await deflateRawAsync(data, { level: 6 });
    e.crc = crc32(data);
    e.usize = data.length;
    e.csize = packed.length;
    await this.put(packed);
    await this.end(e);
    return { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }

  /** Writes the central directory, flushes the file to disk and closes it. Returns the size of the archive. */
  async finish(): Promise<number> {
    const cdOffset = this.pos;
    const parts: Buffer[] = [];
    let cdSize = 0;
    for (const e of this.written) {
      const wide = e.offset >= U32;
      const extra = Buffer.alloc(wide ? 12 : 0);
      if (wide) {
        extra.writeUInt16LE(1, 0);
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(e.offset), 4);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE(wide ? 45 : 20, 4);
      h.writeUInt16LE(wide ? 45 : 20, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(8, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.csize, 20);
      h.writeUInt32LE(e.usize, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(wide ? U32 : e.offset, 42);
      const entry = Buffer.concat([h, e.name, extra]);
      parts.push(entry);
      cdSize += entry.length;
    }
    await this.put(Buffer.concat(parts));
    if (this.written.length >= U16 || cdSize >= U32 || cdOffset >= U32) {
      const z = Buffer.alloc(56 + 20);
      z.writeUInt32LE(SIG_EOCD64, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(this.written.length), 24);
      z.writeBigUInt64LE(BigInt(this.written.length), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdOffset), 48);
      z.writeUInt32LE(SIG_LOCATOR64, 56);
      z.writeBigUInt64LE(BigInt(cdOffset + cdSize), 64);
      z.writeUInt32LE(1, 72);
      await this.put(z);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(Math.min(this.written.length, U16), 8);
    eocd.writeUInt16LE(Math.min(this.written.length, U16), 10);
    eocd.writeUInt32LE(Math.min(cdSize, U32), 12);
    eocd.writeUInt32LE(Math.min(cdOffset, U32), 16);
    await this.put(eocd);
    await this.fh.sync();
    const total = this.pos;
    await this.fh.close();
    return total;
  }

  /** Closes the file without finishing it (cancel or failure; the caller removes the file). */
  async abort(): Promise<void> {
    await this.fh.close().catch(() => {});
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const wide = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw notABackup('zip64');
  return Number(v);
};

export class ZipReader {
  private constructor(
    readonly file: string,
    readonly entries: ZipEntry[],
    readonly size: number,
  ) {}

  /** Reads the central directory. INVALID_REQUEST `not-a-backup` when the file is not a zip this reader understands. */
  static async open(file: string, maxEntries: number): Promise<ZipReader> {
    let fh: FileHandle;
    try {
      fh = await open(file, 'r');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new AppError('NOT_FOUND', 'The backup file does not exist');
      throw new AppError('IO_ERROR', 'The backup file cannot be opened', { code: code ?? 'unknown' });
    }
    try {
      const st = await fh.stat();
      if (!st.isFile() || st.size < 22) throw notABackup('size');
      const tailLen = Math.min(st.size, 22 + U16 + 76);
      const tail = Buffer.alloc(tailLen);
      await fh.read(tail, 0, tailLen, st.size - tailLen);
      let at = -1;
      for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === SIG_EOCD && i + 22 + tail.readUInt16LE(i + 20) === tailLen) {
          at = i;
          break;
        }
      }
      if (at < 0) throw notABackup('eocd');
      let count = tail.readUInt16LE(at + 10);
      let cdSize = tail.readUInt32LE(at + 12);
      let cdOffset = tail.readUInt32LE(at + 16);
      if (count === U16 || cdSize === U32 || cdOffset === U32) {
        if (at < 20 || tail.readUInt32LE(at - 20) !== SIG_LOCATOR64) throw notABackup('zip64');
        const z = Buffer.alloc(56);
        const n = (await fh.read(z, 0, 56, wide(tail.readBigUInt64LE(at - 12)))).bytesRead;
        if (n < 56 || z.readUInt32LE(0) !== SIG_EOCD64) throw notABackup('zip64');
        count = wide(z.readBigUInt64LE(32));
        cdSize = wide(z.readBigUInt64LE(40));
        cdOffset = wide(z.readBigUInt64LE(48));
      }
      if (count > maxEntries || cdSize > MAX_CENTRAL_BYTES || cdOffset + cdSize > st.size) throw notABackup('limits');
      const cd = Buffer.alloc(cdSize);
      let got = 0;
      while (got < cdSize) {
        const r = await fh.read(cd, got, cdSize - got, cdOffset + got);
        if (r.bytesRead === 0) throw notABackup('truncated');
        got += r.bytesRead;
      }
      const entries: ZipEntry[] = [];
      let p = 0;
      for (let i = 0; i < count; i++) {
        if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw notABackup('central');
        const flags = cd.readUInt16LE(p + 8);
        const method = cd.readUInt16LE(p + 10);
        let csize = cd.readUInt32LE(p + 20);
        let usize = cd.readUInt32LE(p + 24);
        const nameLen = cd.readUInt16LE(p + 28);
        const extraLen = cd.readUInt16LE(p + 30);
        const commentLen = cd.readUInt16LE(p + 32);
        let offset = cd.readUInt32LE(p + 42);
        const end = p + 46 + nameLen + extraLen + commentLen;
        if (end > cd.length) throw notABackup('central');
        if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) throw notABackup('method');
        const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
        // Zip64 extra: the fields set to 0xFFFFFFFF, in the order uncompressed size, compressed size, offset.
        let x = p + 46 + nameLen;
        const xEnd = x + extraLen;
        while (x + 4 <= xEnd) {
          const id = cd.readUInt16LE(x);
          const len = cd.readUInt16LE(x + 2);
          if (id === 1) {
            let q = x + 4;
            const take = (): number => {
              if (q + 8 > x + 4 + len) throw notABackup('zip64');
              const v = wide(cd.readBigUInt64LE(q));
              q += 8;
              return v;
            };
            if (usize === U32) usize = take();
            if (csize === U32) csize = take();
            if (offset === U32) offset = take();
          }
          x += 4 + len;
        }
        entries.push({ name, method, crc: cd.readUInt32LE(p + 16), csize, usize, offset });
        p = end;
      }
      return new ZipReader(file, entries, st.size);
    } finally {
      await fh.close().catch(() => {});
    }
  }

  /**
   * The uncompressed bytes of an entry as a stream. An entry that inflates to more than its declared size (a zip bomb)
   * or to less fails the stream with CONFLICT `integrity`.
   */
  stream(e: ZipEntry, signal?: AbortSignal): Readable {
    const { file, size: fileSize } = this;
    let seen = 0;
    const out = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > e.usize) cb(new AppError('CONFLICT', 'An entry is larger than declared', { reason: 'integrity' }));
        else cb(null, chunk);
      },
      flush(cb) {
        cb(seen === e.usize ? null : new AppError('CONFLICT', 'An entry is shorter than declared', { reason: 'integrity' }));
      },
    });
    void (async () => {
      try {
        const fh = await open(file, 'r');
        let dataStart: number;
        try {
          const h = Buffer.alloc(30);
          const n = (await fh.read(h, 0, 30, e.offset)).bytesRead;
          if (n < 30 || h.readUInt32LE(0) !== SIG_LOCAL) throw new AppError('CONFLICT', 'A local header is damaged', { reason: 'integrity' });
          dataStart = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
        } finally {
          await fh.close().catch(() => {});
        }
        if (dataStart + e.csize > fileSize) throw new AppError('CONFLICT', 'An entry runs past the end of the file', { reason: 'integrity' });
        if (e.csize === 0) {
          out.end();
          return;
        }
        const src = createReadStream(file, { start: dataStart, end: dataStart + e.csize - 1 });
        const opts = signal ? { signal } : {};
        await (e.method === 8 ? pipeline(src, createInflateRaw(), out, opts) : pipeline(src, out, opts));
      } catch (err) {
        out.destroy(err as Error);
      }
    })();
    return out;
  }

  /** The whole entry in memory, refused above `maxBytes` (declared size) before anything is inflated. */
  async read(e: ZipEntry, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
    if (e.usize > maxBytes) throw new AppError('CONFLICT', 'An entry is too large to read', { reason: 'too-large' });
    const chunks: Buffer[] = [];
    for await (const c of this.stream(e, signal)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
}
