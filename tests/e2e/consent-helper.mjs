const CONSENT_STORAGE_KEY = 'dataTransmissionConsent';
const CONSENT_VERSION = 1;

/**
 * Executes the real packaged content script in the already-loaded BENCH fixture tab.
 *
 * Firefox 139-142 and supported Fenix versions can accept a temporary XPI but not activate its
 * static local-HTTP content-script match, including when a dynamically registered script is removed
 * with its extension-page owner. The production static declaration remains limited to YouTube; this
 * BENCH-only host-permitted execution invokes the same packaged isolated-world code without broadening
 * production matches.
 */
export async function registerBenchContentScript(driver, extensionPageUrl, fixtureOrigin) {
  const fixturePrefix = `${fixtureOrigin}/watch`;
  const fixtureHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  try {
    await driver.get(extensionPageUrl);
    const result = await driver.executeAsyncScript(
      function (targetUrl) {
        const done = arguments[arguments.length - 1];
        try {
          browser.tabs
            .query({})
            .then((tabs) => {
              const matches = tabs.filter(
                (tab) => typeof tab.id === 'number' && tab.url?.startsWith(targetUrl)
              );
              if (matches.length !== 1 || typeof matches[0]?.id !== 'number') {
                done({
                  ok: false,
                  error: `expected one fixture tab, found ${matches.length}`,
                });
                return;
              }
              return browser.tabs
                .executeScript(matches[0].id, { file: '/content-scripts/content.js' })
                .then(() => done({ ok: true }))
                .catch((error) => done({ ok: false, error: String(error) }));
            })
            .catch((error) => done({ ok: false, error: String(error) }));
        } catch (error) {
          done({ ok: false, error: String(error) });
        }
      },
      fixturePrefix
    );
    if (!result?.ok) {
      throw new Error(`BENCH content-script execution failed: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    await driver.close();
    await driver.switchTo().window(fixtureHandle);
  }
}

/** Seeds explicit extension data consent through an extension-owned page. */
export async function seedDataConsent(
  driver,
  extensionPageUrl,
  { sponsorBlockAllowed = false, assertGranted = true } = {}
) {
  await driver.get(extensionPageUrl);
  const result = await driver.executeAsyncScript(
    function (storageKey, version, allowSponsorBlock) {
      const done = arguments[arguments.length - 1];
      const consent = {
        version,
        decision: 'granted',
        sponsorBlockAllowed: allowSponsorBlock,
      };
      browser.storage.local
        .set({ [storageKey]: consent })
        .then(() =>
          Promise.all([
            browser.storage.local.get(storageKey),
            browser.permissions.getAll(),
            browser.runtime.getBrowserInfo(),
            browser.runtime.getPlatformInfo(),
          ])
        )
        .then(async ([stored, permissions, browserInfo, platformInfo]) => {
          const deadline = Date.now() + 5000;
          let resolved;
          do {
            resolved = await browser.runtime.sendMessage({ type: 'yta:get-data-consent' });
            if (resolved?.granted) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          } while (Date.now() < deadline);
          done({
            ok: true,
            consent: stored[storageKey],
            resolved: {
              ...resolved,
              dataCollection: permissions.data_collection ?? null,
              browserVersion: browserInfo.version,
              platform: platformInfo.os,
            },
          });
        })
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    CONSENT_STORAGE_KEY,
    CONSENT_VERSION,
    sponsorBlockAllowed
  );
  if (!result?.ok) throw new Error(`consent seed failed: ${JSON.stringify(result)}`);
  if (assertGranted && !result.resolved?.granted) {
    throw new Error(
      `consent seed did not resolve granted: ${JSON.stringify(result.resolved ?? result)}`
    );
  }
  // Return the resolved state alongside the stored record. A seed that stores `granted` while the
  // extension resolves denied is the failure mode that hid a cross-version regression, so callers
  // log what the background actually decided rather than what we asked for.
  return { ...result.consent, resolved: result.resolved };
}
