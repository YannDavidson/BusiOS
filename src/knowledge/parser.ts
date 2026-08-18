import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { parse as parseCsv } from 'csv-parse/sync';

const MAX_BYTES = 10 * 1024 * 1024, MAX_TEXT = 500_000;
const injectionPatterns = [
  /ignore (all|any|the) (previous|prior|system) instructions?/i,
  /reveal (the )?(system prompt|credentials|secrets?)/i,
  /bypass (security|approval|authorization|policy)/i,
  /send .* (password|token|customer data|private data) to/i,
  /act as (the )?(system|administrator|owner)/i
];

export async function extractKnowledge(mimeType: string, body: Buffer) {
  if (body.byteLength > MAX_BYTES) throw new Error('File exceeds the 10 MB knowledge limit');
  let text = '';
  if (mimeType === 'application/pdf') { const parser = new PDFParse({ data: new Uint8Array(body) }); try { text = (await parser.getText()).text; } finally { await parser.destroy(); } }
  else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') text = (await mammoth.extractRawText({ buffer: body })).value;
  else if (mimeType === 'text/csv') { const rows = parseCsv(body, { relax_column_count: true, skip_empty_lines: true }) as unknown[][]; text = rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | ')).join('\n'); }
  else text = body.toString('utf8');
  text = text.replace(/\0/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  if (!text) throw new Error('File contains no extractable text');
  const warning = injectionPatterns.find((pattern) => pattern.test(text))?.source;
  return { text, checksum: createHash('sha256').update(body).digest('hex'), warning: warning ? 'Possible prompt-injection instructions detected' : undefined };
}

export function chunks(text: string, size = 1800, overlap = 200) { const values: string[] = []; for (let i = 0; i < text.length; i += size - overlap) { values.push(text.slice(i, i + size).trim()); if (i + size >= text.length) break; } return values.filter(Boolean); }
