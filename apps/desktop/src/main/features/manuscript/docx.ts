import { unzipSync } from 'fflate';
import { AppError } from '@rl/core';
import { DOCX_LIMITS, parseDocxXml, type Heading } from './headings.js';

const fail = (reason: string): AppError => new AppError('IO_ERROR', 'The Word file cannot be read', { reason });

/** Headings of a `.docx`: only `word/document.xml` and `word/styles.xml` are inflated, within the archive limits. */
export function readDocxHeadings(data: Uint8Array): Heading[] {
  let entries = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (++entries > DOCX_LIMITS.entries) throw fail('too-large');
        const cap = f.name === 'word/document.xml' ? DOCX_LIMITS.document : f.name === 'word/styles.xml' ? DOCX_LIMITS.styles : 0;
        if (cap === 0) return false;
        if (f.originalSize > cap) throw fail('too-large');
        total += f.originalSize;
        if (total > DOCX_LIMITS.total) throw fail('too-large');
        return true;
      },
    });
  } catch (e) {
    throw e instanceof AppError ? e : fail('malformed');
  }
  const doc = files['word/document.xml'];
  if (!doc) throw fail('malformed');
  const dec = new TextDecoder('utf-8');
  return parseDocxXml(dec.decode(doc), files['word/styles.xml'] ? dec.decode(files['word/styles.xml']) : '');
}
