const CONSENT_STORAGE_KEY = 'dataTransmissionConsent';
const CONSENT_VERSION = 1;

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
        .then(([stored, permissions, browserInfo, platformInfo]) => {
          const majorVersion = Number.parseInt(browserInfo.version, 10);
          const builtInMinimum = platformInfo.os === 'android' ? 142 : 140;
          const builtInSupported =
            !Number.isFinite(majorVersion) || majorVersion >= builtInMinimum;
          const requiredCategoryGranted =
            Array.isArray(permissions.data_collection) &&
            permissions.data_collection.includes('websiteContent');
          done({
            ok: true,
            consent: stored[storageKey],
            resolved: {
              granted: builtInSupported
                ? requiredCategoryGranted
                : stored[storageKey]?.decision === 'granted',
              source: builtInSupported ? 'firefox' : 'custom',
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
  return result.consent;
}
