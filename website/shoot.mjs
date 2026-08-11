import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '.factory-preview';
const TAG = process.env.TAG || 'site';
const THEMES = (process.env.THEMES || process.env.COLOR_SCHEME || 'light')
  .split(',')
  .map((theme) => theme.trim());
const NOJS = process.env.NOJS === '1';
const LONG_HEADLINE = process.env.LONG_HEADLINE;
const VALIDATE = process.env.VALIDATE === '1';
const USER_AGENT = process.env.UA;
const FOCUS_TARGET = process.env.FOCUS_TARGET;
const HOVER_TARGET = process.env.HOVER_TARGET;
const DEVICE_SCALE_FACTOR = Number(process.env.DSF || 2);

const pages = (process.env.PAGES || '/:home').split(',').map((entry) => {
  const [path, label] = entry.split(':');
  return { path, label };
});

const viewportName = (width) => {
  if (width <= 390) return width === 320 ? 'narrow' : 'mobile';
  if (width <= 900) return 'tablet';
  if (width >= 2000) return 'wide';
  return 'desktop';
};

const viewportHeight = (width) => (width <= 390 ? 844 : 900);
const widths = (process.env.WIDTHS || '390,1440').split(',').map(Number);
const viewports = widths.map((width) => ({
  name: viewportName(width),
  width,
  height: viewportHeight(width),
}));

mkdirSync(OUT, { recursive: true });

const targetUrl = (path) => BASE.replace(/\/$/, '') + (path === '/' ? '/' : path);

async function prepare(page, path) {
  await page.goto(targetUrl(path), { waitUntil: 'load' });

  if (LONG_HEADLINE && path === '/') {
    const replacement =
      LONG_HEADLINE === '1'
        ? 'Listen to every long lecture, deep-focus mix and late-night playlist without making Firefox carry video you never watch.'
        : LONG_HEADLINE;
    await page.locator('.hero__title').evaluate((element, text) => {
      element.textContent = text;
    }, replacement);
  }

  if (NOJS) {
    const images = page.locator('img');
    for (let index = 0; index < (await images.count()); index += 1) {
      await images.nth(index).scrollIntoViewIfNeeded();
      await page.waitForTimeout(25);
    }
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(50);
  } else {
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      window.scrollTo(0, 0);
    });

    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise((resolve) => {
                image.onload = image.onerror = resolve;
              }),
          ),
      ),
    );
  }
  await page.waitForTimeout(100);
}

const parseColor = (value) => {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) throw new Error(`Expected six-digit token color, received "${value}"`);
  return match[1].match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
};

const luminance = (value) => {
  const channels = parseColor(value).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (foreground, background) => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const parseRenderedColor = (value) => {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Expected rendered RGB color, received "${value}"`);
  }
  return `#${channels
    .slice(0, 3)
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function validatePage(page, path, viewport, theme) {
  const structure = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(
      (heading) => Number(heading.tagName.slice(1)),
    );
    const images = Array.from(document.images).map((image) => ({
      alt: image.getAttribute('alt') || '',
      src: image.getAttribute('src') || '',
      complete: image.complete,
      naturalWidth: image.naturalWidth,
    }));
    const root = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      [
        '--color-canvas',
        '--color-surface',
        '--color-surface-raised',
        '--color-surface-subtle',
        '--color-surface-accent',
        '--color-surface-status',
        '--color-content',
        '--color-content-muted',
        '--color-accent',
        '--color-accent-strong',
        '--color-accent-highlight',
        '--color-accent-hover',
        '--color-accent-ink',
        '--color-code-content',
        '--color-image-surface',
        '--color-border',
        '--color-border-subtle',
        '--color-border-strong',
        '--color-focus',
      ].map((token) => [token, root.getPropertyValue(token).trim()]),
    );
    const boundaryElements = Array.from(
      document.querySelectorAll(
        '.card, .browser-note, .experience, .install, .privacy, .doc__side, .guide-head, .footer',
      ),
    ).flatMap((element) => {
      if (!(element instanceof HTMLElement) || element.offsetParent === null) return [];
      const style = getComputedStyle(element);
      const border = [
        [style.borderTopWidth, style.borderTopColor],
        [style.borderRightWidth, style.borderRightColor],
        [style.borderBottomWidth, style.borderBottomColor],
        [style.borderLeftWidth, style.borderLeftColor],
      ]
        .map(([width, color]) => ({ width: Number.parseFloat(width), color }))
        .find((candidate) => candidate.width > 0);
      const ownBackground = style.backgroundColor;
      let ancestor = element.parentElement;
      let outerBackground = getComputedStyle(document.body).backgroundColor;
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        if (candidate !== 'rgba(0, 0, 0, 0)') {
          outerBackground = candidate;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const effectiveOwnBackground =
        ownBackground === 'rgba(0, 0, 0, 0)' ? outerBackground : ownBackground;
      return [
        {
          selector:
            element.id ||
            Array.from(element.classList)
              .map((name) => `.${name}`)
              .join(''),
          borderColor: border?.color ?? style.borderTopColor,
          borderWidth: border?.width ?? 0,
          ownBackground: effectiveOwnBackground,
          outerBackground,
        },
      ];
    });
    const durations = Array.from(document.querySelectorAll('*')).flatMap((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    });

    return {
      h1Count: document.querySelectorAll('h1').length,
      headings,
      images,
      hasHeader: Boolean(document.querySelector('header')),
      hasNav: Boolean(document.querySelector('nav')),
      hasMain: Boolean(document.querySelector('main')),
      hasFooter: Boolean(document.querySelector('footer')),
      hasSkip: document.querySelector('.skip-link')?.getAttribute('href') === '#main',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      installCount: document.querySelectorAll(
        'a[href="https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/"]',
      ).length,
      durations,
      tokens,
      boundaryElements,
      sections: ['experience', 'savings', 'install', 'limits', 'privacy'].map((id) =>
        Boolean(document.getElementById(id)),
      ),
      userAgent: navigator.userAgent,
    };
  });

  assert(structure.h1Count === 1, `${path}: expected one h1, found ${structure.h1Count}`);
  assert(structure.hasHeader && structure.hasNav && structure.hasMain && structure.hasFooter, `${path}: missing landmark`);
  assert(structure.hasSkip, `${path}: skip link does not target main`);
  assert(structure.installCount > 0, `${path}: static AMO install anchor missing`);
  assert(structure.overflow <= 1, `${path}: horizontal overflow is ${structure.overflow}px`);

  for (let index = 1; index < structure.headings.length; index += 1) {
    assert(
      structure.headings[index] <= structure.headings[index - 1] + 1,
      `${path}: heading level skips from h${structure.headings[index - 1]} to h${structure.headings[index]}`,
    );
  }

  for (const image of structure.images) {
    assert(image.alt.trim().length > 0, `${path}: image has empty alt (${image.src})`);
    assert(!/\.png\b/i.test(image.alt), `${path}: image alt repeats a filename (${image.alt})`);
    assert(
      image.complete && image.naturalWidth > 0,
      `${path}: image did not load successfully (${image.src})`,
    );
  }
  if (USER_AGENT) {
    assert(structure.userAgent === USER_AGENT, `${path}: user-agent override did not take effect`);
  }

  const { tokens } = structure;
  for (const [name, value] of Object.entries(tokens)) {
    assert(value.length > 0, `${path} ${theme}: token ${name} is empty`);
  }
  const contrastChecks = [
    ['body content', tokens['--color-content'], tokens['--color-canvas'], 4.5],
    ['muted content', tokens['--color-content-muted'], tokens['--color-surface'], 4.5],
    ['accent text', tokens['--color-accent-strong'], tokens['--color-surface'], 4.5],
    ['accent button', tokens['--color-accent-ink'], tokens['--color-accent'], 4.5],
    [
      'accent button highlight',
      tokens['--color-accent-ink'],
      tokens['--color-accent-highlight'],
      4.5,
    ],
    ['accent button hover', tokens['--color-accent-ink'], tokens['--color-accent-hover'], 4.5],
    ['code block', tokens['--color-code-content'], tokens['--color-image-surface'], 4.5],
  ];
  const boundaryTokens = ['--color-border', '--color-border-subtle', '--color-border-strong'];
  const focusTokens = ['--color-focus'];
  const surfaceTokens = [
    '--color-canvas',
    '--color-surface',
    '--color-surface-raised',
    '--color-surface-subtle',
    '--color-surface-accent',
    '--color-surface-status',
  ];
  for (const boundaryToken of [...boundaryTokens, ...focusTokens]) {
    for (const surfaceToken of surfaceTokens) {
      contrastChecks.push([
        `${boundaryToken} on ${surfaceToken}`,
        tokens[boundaryToken],
        tokens[surfaceToken],
        3,
      ]);
    }
  }

  for (const [name, foreground, background, minimum] of contrastChecks) {
    const ratio = contrast(foreground, background);
    assert(
      ratio >= minimum,
      `${path} ${theme}: ${name} contrast ${ratio.toFixed(2)} is below ${minimum}`,
    );
  }

  for (const boundary of structure.boundaryElements) {
    assert(boundary.borderWidth > 0, `${path}: ${boundary.selector} has no visible boundary`);
    const border = parseRenderedColor(boundary.borderColor);
    for (const [side, background] of [
      ['inside', boundary.ownBackground],
      ['outside', boundary.outerBackground],
    ]) {
      const ratio = contrast(border, parseRenderedColor(background));
      assert(
        ratio >= 3,
        `${path} ${theme}: ${boundary.selector} ${side} boundary contrast ${ratio.toFixed(2)} is below 3`,
      );
    }
  }

  const nonZeroDurations = structure.durations.filter((group) =>
    group
      .split(',')
      .map((value) => Number.parseFloat(value))
      .some((value) => value > 0.001),
  );
  assert(nonZeroDurations.length === 0, `${path}: reduced-motion transitions remain active`);

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    const rect = active.getBoundingClientRect();
    return {
      tag: active.tagName,
      boxShadow: style.boxShadow,
      outlineWidth: style.outlineWidth,
      visible: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  });
  assert(
    focus && focus.visible && Number.parseFloat(focus.outlineWidth) > 0,
    `${path}: keyboard focus is not visibly styled`,
  );
  await page.keyboard.press('Enter');
  const skipWorked = await page.evaluate(
    () => window.location.hash === '#main' && document.activeElement?.id === 'main',
  );
  assert(skipWorked, `${path}: skip link did not move focus to main`);

  const focusableCount = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('*')).filter(
      (element) => element instanceof HTMLElement && element.tabIndex >= 0,
    );
    let index = 0;
    for (const element of candidates) {
      const closedDetails = element.closest('details:not([open])');
      const hiddenByDetails = closedDetails && element !== closedDetails.querySelector('summary');
      const visible =
        element instanceof HTMLElement &&
        (element.matches('.skip-link') || element.offsetParent !== null) &&
        !hiddenByDetails;
      if (visible) {
        element.dataset.focusCheck = String(index);
        index += 1;
      }
    }
    document.body.tabIndex = -1;
    document.body.focus();
    return index;
  });

  const reached = new Set();
  for (let index = 0; index < focusableCount + 20; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const style = getComputedStyle(active);
      return {
        id: active.dataset.focusCheck,
        tag: active.tagName,
        boxShadow: style.boxShadow,
        outlineWidth: style.outlineWidth,
      };
    });
    if (state?.tag === 'BODY') break;
    assert(state, `${path}: tab order did not reach an HTML element`);
    assert(
      Number.parseFloat(state.outlineWidth) > 0,
      `${path}: focused ${state.tag} has no visible focus style`,
    );
    if (state.id !== undefined) reached.add(state.id);
  }
  assert(reached.size === focusableCount, `${path}: tab order missed focusable elements`);

  if (NOJS && viewport.width <= 832) {
    const summary = page.locator('.menu summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('.menu[open] .menu__panel').isVisible(), `${path}: no-JS menu did not open`);
    const internalLinks = await page.locator('.menu[open] a[href^="/youtube-audio/"]').count();
    assert(internalLinks > 0, `${path}: no-JS menu has no base-prefixed navigation links`);
    await page.keyboard.press('Enter');
  }

  if (path === '/') {
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(structure.sections.every(Boolean), '/: landing journey sections are missing');
    const firstViewport = await page.evaluate(() => {
      const title = document.querySelector('.hero__title');
      const lead = document.querySelector('.hero__lead');
      const install = document.querySelector('.hero [data-install]');
      return [title, lead, install].every((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
    });
    assert(
      firstViewport,
      `/: core hero content does not fit ${viewport.width}x${viewport.height}`,
    );
  }
}

const browser = await chromium.launch();

for (const theme of THEMES) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      reducedMotion: 'reduce',
      colorScheme: theme,
      javaScriptEnabled: !NOJS,
      ...(USER_AGENT ? { userAgent: USER_AGENT } : {}),
    });
    const scriptProbe = await context.newPage();
    await scriptProbe.setContent(
      '<script>document.documentElement.dataset.shootJavaScript = "enabled"</script>',
    );
    const scriptRan =
      (await scriptProbe.locator('html').getAttribute('data-shoot-java-script')) === 'enabled';
    assert(
      scriptRan === !NOJS,
      `JavaScript context override did not take effect (expected ${NOJS ? 'disabled' : 'enabled'})`,
    );
    await scriptProbe.close();
    const page = await context.newPage();

    for (const { path, label } of pages) {
      await prepare(page, path);
      if (VALIDATE) await validatePage(page, path, viewport, theme);
      if (FOCUS_TARGET) {
        const target = page.locator(FOCUS_TARGET).first();
        await page.evaluate(() => {
          document.body.tabIndex = -1;
          document.body.focus();
        });
        let targetReached = false;
        for (let index = 0; index < 50; index += 1) {
          await page.keyboard.press('Tab');
          targetReached = await target.evaluate((element) => element === document.activeElement);
          if (targetReached) break;
        }
        assert(targetReached, `${path}: keyboard navigation did not reach ${FOCUS_TARGET}`);
      } else if (HOVER_TARGET) {
        await page.locator(HOVER_TARGET).first().hover();
      } else {
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
      }
      const state = [
        NOJS && 'nojs',
        USER_AGENT && 'unsupported-browser',
        LONG_HEADLINE && 'long-headline',
        FOCUS_TARGET && 'keyboard-focus',
        HOVER_TARGET && 'hover',
      ]
        .filter(Boolean)
        .join('-');
      const filename = [TAG, label, viewport.name, theme, state].filter(Boolean).join('-');
      const output = `${OUT}/${filename}.png`;
      await page.screenshot({ path: output, fullPage: true });
      console.log('shot', output);
    }

    await context.close();
  }
}

await browser.close();
console.log('done');
