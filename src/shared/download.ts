const MAX_FILENAME_LENGTH = 180;
const FALLBACK_TITLE = 'YouTube audio';
export const AUDIO_RANGE_CHUNK_SIZE = 4 * 1024 * 1024;
export const MAX_ASSEMBLED_AUDIO_BYTES = 512 * 1024 * 1024;

export type AudioFetch = (
  input: string,
  init?: { credentials?: RequestCredentials; headers?: HeadersInit }
) => Promise<Response>;

export interface ContentRange {
  start: number;
  end: number;
  total: number;
}

export interface AssembledAudioMedia {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

export function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

function responseMimeType(response: Response): string {
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim();
  return contentType?.startsWith('audio/') ? contentType : 'application/octet-stream';
}

async function readExactResponseBytes(
  response: Response,
  expectedLength: number
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedLength) {
    throw new Error(
      `Audio response body length ${bytes.byteLength} did not match ${expectedLength}`
    );
  }
  return bytes;
}

async function readCompleteResponse(
  response: Response,
  maxBytes: number
): Promise<AssembledAudioMedia> {
  if (response.status !== 200) {
    throw new Error(`Full audio request failed with status ${response.status}`);
  }
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    throw new Error('Full audio response has no valid Content-Length');
  }
  if (declaredLength > maxBytes) throw new Error('Audio media exceeds the size limit');
  return {
    bytes: await readExactResponseBytes(response, declaredLength),
    mimeType: responseMimeType(response),
  };
}

export async function assembleAudioMedia(
  url: string,
  fetcher: AudioFetch = fetch,
  options: { chunkSize?: number; maxBytes?: number } = {}
): Promise<AssembledAudioMedia> {
  const chunkSize = options.chunkSize ?? AUDIO_RANGE_CHUNK_SIZE;
  const maxBytes = options.maxBytes ?? MAX_ASSEMBLED_AUDIO_BYTES;
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
    throw new Error('Invalid audio chunk size');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('Invalid maximum audio size');

  const chunks: Uint8Array[] = [];
  let start = 0;
  let total: number | null = null;
  let mimeType = 'application/octet-stream';

  while (total === null || start < total) {
    const end = total === null ? chunkSize - 1 : Math.min(start + chunkSize - 1, total - 1);
    const response = await fetcher(url, {
      credentials: 'omit',
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (response.status === 200 && start === 0) return readCompleteResponse(response, maxBytes);
    if (response.status !== 206)
      throw new Error(`Audio range request failed with status ${response.status}`);

    const contentRange = parseContentRange(response.headers.get('Content-Range'));
    if (!contentRange && start === 0) {
      const fullResponse = await fetcher(url, { credentials: 'omit' });
      return readCompleteResponse(fullResponse, maxBytes);
    }
    if (!contentRange || contentRange.start !== start || contentRange.end > end) {
      throw new Error('Audio server returned an unexpected byte range');
    }
    if (total !== null && contentRange.total !== total) {
      throw new Error('Audio size changed during download');
    }
    total = contentRange.total;
    if (total > maxBytes) throw new Error('Audio media exceeds the size limit');
    if (start === 0) mimeType = responseMimeType(response);

    const expectedLength = contentRange.end - contentRange.start + 1;
    chunks.push(await readExactResponseBytes(response, expectedLength));
    start = contentRange.end + 1;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, mimeType };
}

export function audioExtensionForItag(itag: number | undefined): '.m4a' | '.webm' {
  return itag === 251 ? '.webm' : '.m4a';
}

function replaceUnsafeFilenameCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || '\\/:*?"<>|'.includes(character) ? '-' : character;
  }).join('');
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function sanitizeDownloadTitle(title: string): string {
  const sanitized = replaceUnsafeFilenameCharacters(title)
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return sanitized || FALLBACK_TITLE;
}

export function buildAudioFilename(title: string, itag: number | undefined): string {
  const extension = audioExtensionForItag(itag);
  const maxTitleLength = MAX_FILENAME_LENGTH - extension.length;
  const safeTitle = sanitizeDownloadTitle(title).slice(0, maxTitleLength).trimEnd();
  return `${safeTitle || FALLBACK_TITLE}${extension}`;
}

export function isSafeDownloadFilename(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_FILENAME_LENGTH ||
    (!value.endsWith('.m4a') && !value.endsWith('.webm')) ||
    value.includes('\\') ||
    value.includes('/') ||
    containsControlCharacter(value) ||
    value !== value.trim()
  ) {
    return false;
  }
  const extensionLength = value.endsWith('.webm') ? 5 : 4;
  const title = value.slice(0, -extensionLength);
  return buildAudioFilename(title, extensionLength === 5 ? 251 : 140) === value;
}

export function isAllowedAudioUrl(value: unknown, benchOrigin?: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))
    ) {
      return true;
    }
    return benchOrigin !== undefined && url.origin === benchOrigin;
  } catch {
    return false;
  }
}
