// Test suite for js/adblocker.js

const fs = require('fs');
const path = require('path');

// Ensure 'self' is available in Node.js for adblocker.js to attach AdBlockerModule
if (typeof self === 'undefined') {
  global.self = global;
}

// Load adblocker.js content
const adblockerJsPath = path.resolve(__dirname, 'adblocker.js');
const adblockerJsCode = fs.readFileSync(adblockerJsPath, 'utf8');

// Variables to hold the AdBlockerModule and its internal functions/state if needed (for advanced testing)
let AdBlockerModule;
let originalChromeStorageGet;
let originalFetch;

// Helper function to re-evaluate the script and re-assign AdBlockerModule
// This allows resetting state and mocks for each test or describe block.
function loadAdblockerScript() {
  // eslint-disable-next-line no-eval
  eval(adblockerJsCode); // This will define self.AdBlockerModule
  AdBlockerModule = self.AdBlockerModule; // Capture the module
  
  // Re-initialize/reset internal state of the module if possible,
  // or ensure tests account for shared state if not.
  // The adblocker.js already calls AdBlockerModule.init() at its end.
  // For tests, we might want to control this, so we can re-init.
  // AdBlockerModule.init(); // Call init explicitly after loading for test control
}


describe('AdBlockerModule', () => {
  beforeAll(() => {
    // Store original implementations if they exist and are not Jest mocks yet
    // This is mainly for cleanup if tests run in a shared global env, less critical for Jest
    if (global.chrome && global.chrome.storage && global.chrome.storage.local) {
        originalChromeStorageGet = global.chrome.storage.local.get;
    }
    originalFetch = global.fetch;
  });
  
  afterAll(() => {
    // Restore original implementations after all tests in this suite
    if (originalChromeStorageGet && global.chrome && global.chrome.storage && global.chrome.storage.local) {
        global.chrome.storage.local.get = originalChromeStorageGet;
    }
    if (originalFetch) {
        global.fetch = originalFetch;
    }
  });

  beforeEach(async () => {
    // Reset all mocks provided by jest.setup.js (like chrome.storage.local.get, global.fetch)
    // jest.setup.js already has a beforeEach to reset mocks.

    // Load (or re-load) the adblocker script to get a fresh AdBlockerModule instance
    // and its initial state (activeAdblockPatterns = [] initially before init runs).
    // The script itself calls AdBlockerModule.init() at the end of its execution.
    // We need to control the mocks *before* this init call happens.

    // Mock fetch before loading the script
    global.fetch.mockImplementation((url) => {
        if (url.includes('easylist.txt') || url.includes('fanboy-annoyance.txt')) {
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('||doubleclick.net^\n/adsense/script.js'),
            });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve(''), json: () => Promise.resolve([]) });
    });
    
    // Mock chrome.storage.local.get before loading the script for the initial loadAdblockPatternsInternal
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        // Default behavior: no cache, adblocking enabled
        const result = { adblocking_enabled: true }; 
        if (Array.isArray(keys)) {
            keys.forEach(key => {
                if (!(key in result)) result[key] = undefined;
            });
        } else if (typeof keys === 'object') { // Handles cases like get({key: defaultValue})
             Object.assign(result, keys); // Start with defaults
        }
        callback(result);
    });
    
    loadAdblockerScript(); // This will define AdBlockerModule and run its init
    // Wait for the init (which includes async loadAdblockPatternsInternal) to complete.
    // This is tricky because init is called at the end of adblocker.js.
    // Forcing a slight delay or a more robust signaling mechanism would be better.
    // For now, we rely on the fact that subsequent calls to shouldBlock will use the loaded patterns.
    // A short delay to allow async operations in init to settle.
    await new Promise(resolve => setTimeout(resolve, 100)); 
  });

  describe('Initialization and Pattern Loading (via AdBlockerModule.init)', () => {
    test('should fetch and parse lists if no fresh cache exists', async () => {
      // fetch is mocked in beforeEach to return minimal list.
      // init is called when adblocker.js is eval'd.
      // We need to check side effects: chrome.storage.local.set being called.
      
      // Reset mocks to check calls specifically for this test
      global.fetch.mockClear();
      global.chrome.storage.local.set.mockClear();
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({}); // Simulate empty cache
      });

      await AdBlockerModule.init(); // Re-init to test this specific scenario

      expect(global.fetch).toHaveBeenCalledTimes(2); // For EasyList and Fanboy
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [AdBlockerModule._ADBLOCK_CACHE_KEY_FOR_TEST_ONLY || 'adblock_patterns_cache']: expect.arrayContaining([
            { type: 'domain', value: 'doubleclick.net' },
            { type: 'url_part', value: '/adsense/script.js' }
          ]),
          [AdBlockerModule._ADBLOCK_TIMESTAMP_KEY_FOR_TEST_ONLY || 'adblock_patterns_timestamp']: expect.any(Number),
        }),
        expect.any(Function)
      );
    });

    test('should load patterns from fresh cache and not fetch', async () => {
      const now = Date.now();
      const freshPatterns = [{ type: 'domain', value: 'cacheddomain.com' }];
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          [AdBlockerModule._ADBLOCK_CACHE_KEY_FOR_TEST_ONLY || 'adblock_patterns_cache']: freshPatterns,
          [AdBlockerModule._ADBLOCK_TIMESTAMP_KEY_FOR_TEST_ONLY || 'adblock_patterns_timestamp']: now,
          adblocking_enabled: true, // ensure it's considered active
        });
      });
      global.fetch.mockClear();
      
      await AdBlockerModule.init();

      expect(global.fetch).not.toHaveBeenCalled();
      // Check if activeAdblockPatterns is set (indirectly, or if exposed for test)
      // For now, test via shouldBlockRequest
      const blockDetails = { url: 'http://cacheddomain.com/ads.js', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(blockDetails);
      expect(decision).toEqual({ cancel: true });
    });

    test('should fetch lists if cache is stale', async () => {
      const staleTimestamp = Date.now() - (2 * (AdBlockerModule._STALE_THRESHOLD_MS_FOR_TEST_ONLY || 24 * 60 * 60 * 1000));
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          [AdBlockerModule._ADBLOCK_CACHE_KEY_FOR_TEST_ONLY || 'adblock_patterns_cache']: [{ type: 'domain', value: 'staledomain.com' }],
          [AdBlockerModule._ADBLOCK_TIMESTAMP_KEY_FOR_TEST_ONLY || 'adblock_patterns_timestamp']: staleTimestamp,
          adblocking_enabled: true,
        });
      });
      global.fetch.mockClear();
      global.chrome.storage.local.set.mockClear(); // To check if it's called after fetching

      await AdBlockerModule.init();

      expect(global.fetch).toHaveBeenCalledTimes(2); // Fetches new lists
      expect(global.chrome.storage.local.set).toHaveBeenCalled(); // Caches the new lists
    });
  });

  describe('AdBlockerModule.shouldBlock(details)', () => {
    test('should resolve undefined if adblocking_enabled is false', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: false });
      });
      // Re-initialize AdBlockerModule with the new storage mock for this specific test context if needed,
      // or ensure shouldBlock re-fetches. The current shouldBlock fetches storage on each call.
      
      const details = { url: 'http://doubleclick.net/pagead/ads?id=123', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toBeUndefined();
    });

    test('should resolve {cancel: true} for matching domain pattern when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        // Ensure adblocking is enabled and provide patterns directly to activeAdblockPatterns for this test
        callback({ adblocking_enabled: true });
      });
      // Manually set activeAdblockPatterns for this test after module load
      self.activeAdblockPatterns = [{ type: 'domain', value: 'doubleclick.net' }];

      const details = { url: 'http://doubleclick.net/pagead/ads?id=123', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toEqual({ cancel: true });
    });
    
    test('should resolve {cancel: true} for matching subdomain pattern when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = [{ type: 'domain', value: 'doubleclick.net' }];
      const details = { url: 'http://ads.doubleclick.net/pagead/ads?id=123', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toEqual({ cancel: true });
    });

    test('should resolve {cancel: true} for matching url_part pattern when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = [{ type: 'url_part', value: '/adsense/script.js' }];
      const details = { url: 'http://example.com/adsense/script.js?id=1', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toEqual({ cancel: true });
    });

    test('should resolve {cancel: true} for matching wildcard pattern when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = [{ type: 'wildcard', value: '*banner=true*' }];
      const details = { url: 'http://example.com/script.js?banner=true&id=1', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toEqual({ cancel: true });
    });
    
    test('should resolve {cancel: true} for domain_path pattern when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = [{ type: 'domain_path', value: 'eviltracker.com/trackthis/' }];
      const details = { url: 'http://eviltracker.com/trackthis/event.gif', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toEqual({ cancel: true });
    });


    test('should resolve undefined for non-matching URL when enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = [{ type: 'domain', value: 'doubleclick.net' }];
      const details = { url: 'http://example.com/cleanpage.html', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toBeUndefined();
    });

    test('should resolve undefined if activeAdblockPatterns is empty and enabled', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ adblocking_enabled: true });
      });
      self.activeAdblockPatterns = []; // Ensure patterns are empty
      const details = { url: 'http://doubleclick.net/pagead/ads?id=123', tabId: 1 };
      const decision = await AdBlockerModule.shouldBlock(details);
      expect(decision).toBeUndefined();
    });
  });
});

// Expose internal constants for testing cache logic (not ideal, but useful for this structure)
// This would ideally be done by exporting from the module if it were a real module.
if (self.AdBlockerModule) {
    AdBlockerModule._ADBLOCK_CACHE_KEY_FOR_TEST_ONLY = 'adblock_patterns_cache';
    AdBlockerModule._ADBLOCK_TIMESTAMP_KEY_FOR_TEST_ONLY = 'adblock_patterns_timestamp';
    AdBlockerModule._STALE_THRESHOLD_MS_FOR_TEST_ONLY = 24 * 60 * 60 * 1000;
}
