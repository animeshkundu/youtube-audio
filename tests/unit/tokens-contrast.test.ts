import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * WCAG contrast regression guard for the token ramp (A2). Parses `tokens.css` and asserts the
 * defined foreground/background pairs meet AA in both themes: button text on every accent state
 * (4.5:1 for 14px body text), accent text on surfaces, the focus ring vs surfaces (3:1), and
 * body/secondary/tertiary text on surfaces.
 */
const css = readFileSync(resolve(__dirname, '../../entrypoints/ui/tokens.css'), 'utf8');

function blockVars(cssText: string, startMarker: string, endMarker?: string): Map<string, string> {
  const start = cssText.indexOf(startMarker);
  if (start < 0) return new Map();
  const end = endMarker ? cssText.indexOf(endMarker, start) : cssText.length;
  const endIndex = end < 0 ? cssText.length : end;
  const block = cssText.slice(start, endIndex);
  const vars = new Map<string, string>();
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const raw = match[2];
    if (name !== undefined && raw !== undefined) vars.set(name, raw.trim());
  }
  return vars;
}

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().toLowerCase();
  const long = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const num = Number.parseInt(long.slice(1), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: string, b: string): number {
  const l1 = luminance(parseColor(a));
  const l2 = luminance(parseColor(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Dark theme lives in `:root`; light theme in the `prefers-color-scheme: light` block.
const dark = blockVars(css, ':root {', '@media (prefers-color-scheme: light)');
const light = blockVars(css, '@media (prefers-color-scheme: light)', '@media (prefers-contrast');

describe('token contrast (WCAG AA)', () => {
  it('parses both themes', () => {
    expect(dark.get('accent')).toMatch(/^#/);
    expect(light.get('accent')).toMatch(/^#/);
  });

  it('keeps button text readable on every light accent state', () => {
    const on = light.get('text-on-accent')!;
    for (const state of ['accent', 'accent-hover', 'accent-press']) {
      expect(ratio(on, light.get(state)!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps button text readable on every dark accent state', () => {
    const on = dark.get('text-on-accent')!;
    for (const state of ['accent', 'accent-hover', 'accent-press']) {
      expect(ratio(on, dark.get(state)!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps accent text readable on surfaces in both themes', () => {
    expect(ratio(light.get('accent-text')!, light.get('surface-0')!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark.get('accent-text')!, dark.get('surface-0')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring visible against surfaces in both themes', () => {
    // Focus indicators need 3:1 against adjacent colors (WCAG 2.4.11/1.4.11).
    for (const theme of [light, dark]) {
      for (const surface of ['surface-0', 'surface-1']) {
        expect(ratio(theme.get('accent-hover')!, theme.get(surface)!)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps body, secondary, and tertiary text readable on surfaces', () => {
    for (const theme of [light, dark]) {
      for (const text of ['text-primary', 'text-secondary', 'text-tertiary']) {
        for (const surface of ['surface-0', 'surface-1']) {
          expect(ratio(theme.get(text)!, theme.get(surface)!)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
