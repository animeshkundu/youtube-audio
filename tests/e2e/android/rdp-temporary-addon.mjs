import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const RDP_MODULE = pathToFileURL(
  resolve(REPO_ROOT, 'node_modules/web-ext/lib/firefox/remote.js')
).href;
const DEVICE_ARTIFACTS_DIR = `/data/local/tmp/web-ext-artifacts-yta-${process.pid}`;
const SOCKET_TIMEOUT_MS = 180_000;
const SOCKET_POLL_MS = 3_000;

function adb(serial, args) {
  return execFileSync(process.env.ADB_BIN || 'adb', ['-s', serial, ...args], {
    encoding: 'utf8',
  });
}

function assertFenixPackage(packageName) {
  if (!/^org\.mozilla\.(?:fenix|firefox)$/.test(packageName)) {
    throw new Error(`unexpected Firefox Android package: ${packageName}`);
  }
}

async function waitForDebugSocket(serial, packageName) {
  const suffix = `/${packageName}/firefox-debugger-socket`;
  const deadline = Date.now() + SOCKET_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const sockets = adb(serial, ['shell', 'cat', '/proc/net/unix'])
      .split('\n')
      .filter((line) => line.trim().endsWith(suffix))
      .map((line) => line.trim().split(/\s+/).at(-1))
      .filter((socket) => typeof socket === 'string' && socket.length > 0);
    if (sockets.length > 1) {
      throw new Error(`multiple Firefox Android remote debugging sockets: ${sockets.join(', ')}`);
    }
    if (sockets.length === 1) return sockets[0];
    await new Promise((resolveWait) => setTimeout(resolveWait, SOCKET_POLL_MS));
  }
  throw new Error(`Firefox Android remote debugging socket was unavailable for ${packageName}`);
}

/**
 * Installs an XPI through Firefox Android's Remote Debugging Protocol add-ons actor.
 *
 * Marionette's installAddon command is desktop-only on Firefox 128 Android. The RDP actor is the
 * supported temporary-install transport for Fenix and works without changing the add-on's manifest.
 */
export async function installTemporaryAddonWithRdp(xpiPath, packageName) {
  assertFenixPackage(packageName);
  const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
  const deviceXpi = `${DEVICE_ARTIFACTS_DIR}/youtube-audio-bench.xpi`;
  adb(serial, ['shell', 'mkdir', '-p', DEVICE_ARTIFACTS_DIR]);
  adb(serial, ['push', xpiPath, deviceXpi]);
  adb(serial, ['shell', 'chmod', '644', deviceXpi]);

  const socket = await waitForDebugSocket(serial, packageName);
  const { connectWithMaxRetries, findFreeTcpPort } = await import(RDP_MODULE);
  const port = await findFreeTcpPort();
  const remoteSocket = socket.startsWith('@')
    ? `localabstract:${socket.slice(1)}`
    : `localfilesystem:${socket}`;
  let remoteFirefox;
  let forwardCreated = false;
  try {
    adb(serial, ['forward', `tcp:${port}`, remoteSocket]);
    forwardCreated = true;
    remoteFirefox = await connectWithMaxRetries({ port, maxRetries: 120, retryInterval: 250 });
    const result = await remoteFirefox.installTemporaryAddon(deviceXpi);
    const addonId = result?.addon?.id;
    if (typeof addonId !== 'string' || addonId.length === 0) {
      throw new Error(`RDP temporary install returned no add-on id: ${JSON.stringify(result)}`);
    }
    return {
      addonId,
      dispose: () => {
        adb(serial, ['forward', '--remove', `tcp:${port}`]);
        adb(serial, ['shell', 'rm', '-f', deviceXpi]);
        adb(serial, ['shell', 'rmdir', DEVICE_ARTIFACTS_DIR]);
      },
    };
  } catch (error) {
    const cleanupFailures = [];
    if (forwardCreated) {
      try {
        adb(serial, ['forward', '--remove', `tcp:${port}`]);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    try {
      adb(serial, ['shell', 'rm', '-f', deviceXpi]);
      adb(serial, ['shell', 'rmdir', DEVICE_ARTIFACTS_DIR]);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        'Firefox Android Remote Debugging Protocol temporary installation and cleanup failed'
      );
    }
    throw error;
  } finally {
    remoteFirefox?.disconnect();
  }
}
