export interface ExtensionPlatform {
  manifestVersion: 2 | 3;
  persistentBackground: boolean;
  blockingWebRequest: boolean;
}

export function getExtensionPlatform(): ExtensionPlatform {
  const manifestVersion = browser.runtime.getManifest().manifest_version as 2 | 3;
  return {
    manifestVersion,
    persistentBackground: manifestVersion === 2,
    blockingWebRequest: manifestVersion === 2,
  };
}

// TODO(S6/M2): Put interception and background-lifecycle implementations behind this adapter.
