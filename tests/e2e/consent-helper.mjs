const CONSENT_STORAGE_KEY = 'dataTransmissionConsent';
const CONSENT_VERSION = 1;

/**
 * Registers the real packaged content script for a BENCH fixture before navigating to it.
 *
 * Firefox 139-142 and supported Fenix versions can accept a temporary XPI but not activate its
 * static local-HTTP content-script match. The production static declaration remains limited to
 * YouTube; this registration uses the BENCH-only host permission and avoids double injection. Firefox
 * unregisters dynamically registered scripts when their originating extension document unloads, so
 * retain a dedicated extension tab for the rest of the browser session.
 */
export async function registerBenchContentScript(driver, extensionPageUrl, fixtureOrigin) {
  const fixture = new URL(fixtureOrigin);
  const match = `${fixture.protocol}//${fixture.hostname}/*`;
  const callerHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const registrationHandle = await driver.getWindowHandle();
  try {
    await driver.get(extensionPageUrl);
    const result = await driver.executeAsyncScript(
      function (fixtureMatch) {
        const done = arguments[arguments.length - 1];
        try {
          browser.contentScripts
            .register({
              matches: [fixtureMatch],
              js: [{ file: 'content-scripts/content.js' }],
              runAt: 'document_start',
            })
            .then(() => done({ ok: true, match: fixtureMatch }))
            .catch((error) => done({ ok: false, error: String(error) }));
        } catch (error) {
          done({ ok: false, error: String(error) });
        }
      },
      match
    );
    if (!result?.ok) {
      throw new Error(`BENCH content-script registration failed: ${JSON.stringify(result)}`);
    }
    await driver.switchTo().window(callerHandle);
    return { ...result, registrationHandle };
  } catch (error) {
    try {
      await driver.close();
      await driver.switchTo().window(callerHandle);
    } catch {
      // Preserve the registration failure, which is the actionable cause.
    }
    throw error;
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
