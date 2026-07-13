/**
 * A targeted defensive scrub for known PII shapes. It is a safety net applied over the final
 * assembled report; the primary guarantee is the closed event schema in `logger.ts`, which
 * never lets a free-text value in. These rules are deliberately narrow so they neutralize real
 * identifiers (URLs, watch and short forms, ids, emails, IP addresses, extension UUIDs) without
 * mangling the extension's own enum vocabulary (for example `LOGIN_REQUIRED`, which carries no
 * digit and is longer than an id token).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HTTP_URL = /\bhttps?:\/\/[^\s"'<>)\]}]+/gi;
const EXTENSION_URL = /\b(?:moz|chrome)-extension:\/\/[0-9a-fA-F-]+/gi;
const WATCH_PARAM = /([?&]v=)[A-Za-z0-9_-]{11}\b/g;
const SHORT_HOST = /(youtu\.be\/)[A-Za-z0-9_-]{11}\b/gi;
const PATH_ID = /(\/(?:embed|shorts|live|v)\/)[A-Za-z0-9_-]{11}\b/gi;
const LIST_PARAM = /([?&](?:list|pp|si)=)[A-Za-z0-9_-]+/gi;
const CHANNEL_PATH = /(\/channel\/)[A-Za-z0-9_-]+/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b/g;
// An 11-character YouTube-id-shaped token bounded by non-id characters and containing at least
// one digit. Requiring a digit spares digit-free enum words while catching real video ids.
const BARE_ID = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{11}(?![A-Za-z0-9_-])/g;

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match?.[1] ?? '?';
}

/**
 * Redact known PII shapes from arbitrary text. URLs collapse to their hostname (query strings,
 * which carry tokens and IPs, are dropped); watch, short, embed, list, and channel identifiers
 * collapse to a placeholder; emails, IP addresses, and extension UUIDs are removed. The result
 * has no length cap so it can be run over a whole report without truncating it.
 */
export function redactText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let output = input;
  output = output.replace(EMAIL, '[email]');
  output = output.replace(HTTP_URL, (url) => `[url:${hostOf(url)}]`);
  output = output.replace(EXTENSION_URL, (match) => `${match.split('://')[0]}://[ext]`);
  output = output.replace(WATCH_PARAM, '$1[id]');
  output = output.replace(SHORT_HOST, '$1[id]');
  output = output.replace(PATH_ID, '$1[id]');
  output = output.replace(LIST_PARAM, '$1[id]');
  output = output.replace(CHANNEL_PATH, '$1[id]');
  output = output.replace(IPV4, '[ip]');
  output = output.replace(IPV6, '[ip]');
  output = output.replace(BARE_ID, '[id]');
  return output;
}
