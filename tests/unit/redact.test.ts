import { describe, expect, it } from 'vitest';

import { redactText } from '../../src/shared/redact';

describe('redactText', () => {
  it('strips a signed googlevideo URL down to its host, dropping tokens, ip, and video id', () => {
    const url =
      'https://rr3---sn-4g5e6nez.googlevideo.com/videoplayback?expire=1699999999&ei=abc&ip=203.0.113.7&id=o-AbCdEf&itag=140&signature=DEADBEEF1234&videoId=dQw4w9WgXcQ';
    const out = redactText(`fetch failed for ${url}`);
    expect(out).not.toContain('dQw4w9WgXcQ');
    expect(out).not.toContain('DEADBEEF1234');
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('videoplayback');
    expect(out).not.toContain('signature');
    expect(out).toContain('[url:rr3---sn-4g5e6nez.googlevideo.com]');
  });

  it('removes the video id from watch, short, embed, and bare v= forms', () => {
    expect(redactText('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).not.toContain(
      'dQw4w9WgXcQ'
    );
    expect(redactText('youtu.be/dQw4w9WgXcQ')).not.toContain('dQw4w9WgXcQ');
    expect(redactText('path /embed/dQw4w9WgXcQ here')).not.toContain('dQw4w9WgXcQ');
    expect(redactText('id v=dQw4w9WgXcQ trailing')).not.toContain('dQw4w9WgXcQ');
  });

  it('removes list, channel, email, ip, and extension identifiers', () => {
    expect(redactText('watch?v=aaaaaaaaaaa&list=PL1234567890abcdef')).not.toContain(
      'PL1234567890abcdef'
    );
    expect(redactText('/channel/UCabcdef123456')).not.toContain('UCabcdef123456');
    expect(redactText('contact me at user.name@example.com now')).not.toContain(
      'user.name@example.com'
    );
    expect(redactText('server 203.0.113.42 responded')).not.toContain('203.0.113.42');
    expect(redactText('at moz-extension://11111111-2222-4333-8444-555555555555/x.js')).toContain(
      'moz-extension://[ext]'
    );
  });

  it('redacts a bare digit-bearing 11-character id token', () => {
    expect(redactText('token FIXTURE0001 stored')).not.toContain('FIXTURE0001');
    expect(redactText('id dQw4w9WgXcQ done')).not.toContain('dQw4w9WgXcQ');
  });

  it('preserves the extension enum vocabulary and short/long non-id words', () => {
    expect(redactText('reason=LOGIN_REQUIRED status=fallback')).toContain('LOGIN_REQUIRED');
    expect(redactText('state INITIALIZED reached')).toContain('INITIALIZED');
    expect(redactText('reason=no-direct-audio')).toContain('no-direct-audio');
    expect(redactText('http-403')).toContain('http-403');
    expect(redactText('environment diagnostics settings')).toContain(
      'environment diagnostics settings'
    );
  });

  it('returns non-string and empty input unchanged', () => {
    expect(redactText('')).toBe('');
    expect(redactText(42 as unknown as string)).toBe(42 as unknown as string);
  });
});
