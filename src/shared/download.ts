const MAX_FILENAME_LENGTH = 180;
const FALLBACK_TITLE = 'YouTube audio';

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
