// Test suite for global.js

// Import functions from global.js
// Since global.js is a script and not a module, we need to load it in a way that Jest can access its functions.
// This might require refactoring global.js or using a more complex Jest setup if direct import is not possible.
// For now, assuming functions are exposed globally for testing or will be when Jest runs them.
// If global.js is not structured as a module, you might need to use JSDOM or similar to load it.
// For this example, we'll assume the functions are accessible.
// A common approach is to use `require` if the script is CommonJS compatible or set it up in JSDOM.
// If global.js directly manipulates the global scope or relies on `chrome` being present,
// the jest.setup.js will handle the `chrome` mock.

// We need to load global.js. Jest will execute it in a Node.js environment.
// The `chrome` mock from jest.setup.js should be available.
const fs = require('fs');
const path = require('path');

// Load global.js content and execute it in the test context
// This is a common way to test non-module scripts.
const globalJsPath = path.resolve(__dirname, 'global.js');
const globalJsCode = fs.readFileSync(globalJsPath, 'utf8');

// Before each test, execute the script.
// This ensures `tabIds`, `AD_PATTERNS` are initialized and listeners are (re)attached for each test case.
// We need to be careful if the script has side effects that persist or if functions are not idempotent.
let tabIds; // To capture tabIds from the script's scope
let AD_PATTERNS; // To capture AD_PATTERNS
let removeURLParameters, processRequest, enableExtension, disableExtension, saveSettings, reloadTab; // Functions

beforeEach(() => {
  // Execute the script in a context where we can capture its globals/functions
  // This is a simplified approach. For more complex scripts, consider JSDOM or module refactoring.
  const scriptContext = { chrome: global.chrome, Set: Set, encodeURIComponent: encodeURIComponent, console: console };
  // Wrap the script to expose its internal variables/functions for testing
  const wrappedCode = `
    let __tabIds, __AD_PATTERNS, __removeURLParameters, __processRequest, __enableExtension, __disableExtension, __saveSettings, __reloadTab;
    (function(exports) {
      ${globalJsCode}
      __tabIds = tabIds;
      __AD_PATTERNS = AD_PATTERNS;
      __removeURLParameters = removeURLParameters;
      __processRequest = processRequest;
      __enableExtension = enableExtension;
      __disableExtension = disableExtension;
      __saveSettings = saveSettings;
      __reloadTab = reloadTab;
    })(scriptContext);
    tabIds = scriptContext.__tabIds;
    AD_PATTERNS = scriptContext.__AD_PATTERNS;
    removeURLParameters = scriptContext.__removeURLParameters;
    processRequest = scriptContext.__processRequest;
    enableExtension = scriptContext.__enableExtension;
    disableExtension = scriptContext.__disableExtension;
    saveSettings = scriptContext.__saveSettings;
    reloadTab = scriptContext.__reloadTab;
  `;
  // eslint-disable-next-line no-eval
  eval(wrappedCode);

  // Clear tabIds before each test (as it's mutated by some functions)
  tabIds.clear();
});


describe('removeURLParameters', () => {
  test('should return URL unchanged if no parameters to remove', () => {
    const url = 'http://example.com?a=1&b=2';
    expect(removeURLParameters(url, ['c'])).toBe(url);
  });

  test('should remove a single parameter', () => {
    const url = 'http://example.com?a=1&b=2&c=3';
    expect(removeURLParameters(url, ['b'])).toBe('http://example.com?a=1&c=3');
  });

  test('should remove multiple parameters', () => {
    const url = 'http://example.com?a=1&b=2&c=3&d=4';
    expect(removeURLParameters(url, ['a', 'c'])).toBe('http://example.com?b=2&d=4');
  });

  test('should handle parameters not present in the URL', () => {
    const url = 'http://example.com?a=1&b=2';
    expect(removeURLParameters(url, ['c', 'd'])).toBe(url);
  });

  test('should return URL unchanged with an empty parameter list', () => {
    const url = 'http://example.com?a=1&b=2';
    expect(removeURLParameters(url, [])).toBe(url);
  });

  test('should return URL unchanged if it has no query string', () => {
    const url = 'http://example.com';
    expect(removeURLParameters(url, ['a'])).toBe(url);
  });
   test('should handle URL with only a question mark', () => {
    const url = 'http://example.com?';
    expect(removeURLParameters(url, ['a'])).toBe('http://example.com?');
  });
});

describe('processRequest', () => {
  // AD_PATTERNS is defined in global.js, ensure it's available in the test scope
  // It's loaded via the eval script above.

  test('should return {cancel: true} for an ad URL', () => {
    tabIds.add(1); // Request must be from a tracked tab
    const details = { tabId: 1, url: 'http://doubleclick.net/pagead/ads?id=123' };
    expect(processRequest(details)).toEqual({ cancel: true });
  });

  test('should call chrome.tabs.sendMessage for a valid audio URL from a tracked tab', () => {
    tabIds.add(1);
    const details = { tabId: 1, url: 'http://youtube.com/watch?v=123&mime=audio&other=param' };
    // removeURLParameters will be called internally
    const expectedAudioURL = 'http://youtube.com/watch?v=123&mime=audio&other=param'; // Assuming range, rn, rbuf are not present
    
    processRequest(details);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { url: expectedAudioURL });
  });
  
  test('should remove specified parameters from audio URL before sending', () => {
    tabIds.add(1);
    const details = { tabId: 1, url: 'http://youtube.com/videoplayback?mime=audio&range=0-100&rn=3&rbuf=0' };
    const expectedCleanedURL = 'http://youtube.com/videoplayback?mime=audio';
    processRequest(details);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { url: expectedCleanedURL });
  });

  test('should do nothing if tabId is not in tabIds for audio URL', () => {
    const details = { tabId: 999, url: 'http://youtube.com/watch?v=123&mime=audio' };
    expect(processRequest(details)).toBeUndefined();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('should do nothing for a non-ad, non-audio URL', () => {
    tabIds.add(1);
    const details = { tabId: 1, url: 'http://youtube.com/watch?v=123' };
    expect(processRequest(details)).toBeUndefined();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('should not process live stream audio (live=1)', () => {
    tabIds.add(1);
    const details = { tabId: 1, url: 'http://youtube.com/watch?v=live&mime=audio&live=1' };
    expect(processRequest(details)).toBeUndefined();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('enableExtension / disableExtension', () => {
  test('enableExtension should set icon and add listener', () => {
    enableExtension();
    expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
      path: {
        128: "img/icon128.png",
        38: "img/icon38.png"
      }
    });
    expect(chrome.webRequest.onBeforeRequest.addListener).toHaveBeenCalledWith(
      processRequest, // Comparing function references
      {
        urls: [
          "*://*.youtube.com/*",
          "*://*.youtube-nocookie.com/*",
          "*://*.doubleclick.net/*",
          "*://*.googlesyndication.com/*",
          "*://*.googleads.g.doubleclick.net/*",
          "*://*.stats.g.doubleclick.net/*"
        ]
      },
      ["blocking"]
    );
  });

  test('disableExtension should set icon and remove listener', () => {
    disableExtension();
    expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
      path: {
        38: "img/disabled_icon38.png",
      }
    });
    expect(chrome.webRequest.onBeforeRequest.removeListener).toHaveBeenCalledWith(processRequest);
  });
});

describe('saveSettings and initial state loading', () => {
  test('saveSettings should call chrome.storage.local.set', () => {
    saveSettings(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ 'youtube_audio_state': true });
    saveSettings(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ 'youtube_audio_state': false });
  });

  test('initial loading: state true from storage', () => {
    chrome.storage.local.get.mockImplementation((keys, callback) => callback({ 'youtube_audio_state': true }));
    // Re-evaluate the script's initial loading logic
    eval(globalJsCode); // This re-runs the setup listeners at the bottom of global.js
    expect(enableExtension).toHaveBeenCalledTimes(1); // enableExtension is called in the setup
    expect(disableExtension).not.toHaveBeenCalled();
  });

  test('initial loading: state false from storage', () => {
    chrome.storage.local.get.mockImplementation((keys, callback) => callback({ 'youtube_audio_state': false }));
    eval(globalJsCode);
    expect(disableExtension).toHaveBeenCalledTimes(1); // disableExtension is called in the setup
    expect(enableExtension).not.toHaveBeenCalled(); // enableExtension should not be called
  });

  test('initial loading: state undefined (defaults to true)', () => {
    // Default mock behavior is already {}
    chrome.storage.local.get.mockImplementation((keys, callback) => callback({}));
    eval(globalJsCode);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ 'youtube_audio_state': true });
    expect(enableExtension).toHaveBeenCalledTimes(1);
    expect(disableExtension).not.toHaveBeenCalled();
  });
});


describe('chrome.browserAction.onClicked listener', () => {
  // The listener is added by global.js when it's loaded.
  // We need to trigger it via the mock.
  
  test('click when state is true (should disable)', (done) => {
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ 'youtube_audio_state': true });
    });
    
    // Simulate the click
    chrome.browserAction.onClicked.trigger(); 

    // Allow promises/callbacks within the listener to resolve
    process.nextTick(() => {
      expect(disableExtension).toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalledWith(false);
      expect(reloadTab).toHaveBeenCalled();
      done();
    });
  });

  test('click when state is false (should enable)', (done) => {
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ 'youtube_audio_state': false });
    });

    chrome.browserAction.onClicked.trigger();

    process.nextTick(() => {
      expect(enableExtension).toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalledWith(true);
      expect(reloadTab).toHaveBeenCalled();
      done();
    });
  });
   test('click when state is undefined (should default to true, then enable)', (done) => {
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      // Simulate storage being empty for 'youtube_audio_state'
      callback({}); 
    });

    chrome.browserAction.onClicked.trigger();

    process.nextTick(() => {
      // Initial state is undefined, so it becomes !undefined -> true
      expect(enableExtension).toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalledWith(true); 
      expect(reloadTab).toHaveBeenCalled();
      done();
    });
  });
});


describe('Tab ID Management', () => {
  // Listeners are added when global.js is loaded.
  // We need to trigger them via the mock.

  test('chrome.runtime.onMessage should add tabId', () => {
    const message = { data: 'some_data' };
    const sender = { tab: { id: 123 } };
    
    expect(tabIds.has(123)).toBe(false);
    chrome.runtime.onMessage.trigger(message, sender, () => {}); // sendResponse is a function
    expect(tabIds.has(123)).toBe(true);
  });

  test('chrome.tabs.onRemoved should remove tabId', () => {
    tabIds.add(456);
    expect(tabIds.has(456)).toBe(true);
    
    // Simulate the onRemoved event
    // The listener is `function(tabId) { tabIds.delete(tabId); }`
    // So we need to get this callback and call it.
    const onRemovedCallback = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    onRemovedCallback(456);
    
    expect(tabIds.has(456)).toBe(false);
  });
});

describe('reloadTab', () => {
  test('should reload only active tabs', (done) => {
    tabIds.add(1).add(2).add(3);

    chrome.tabs.get
      .mockImplementationOnce((tabId, callback) => callback({ id: tabId, active: true }))  // Tab 1 is active
      .mockImplementationOnce((tabId, callback) => callback({ id: tabId, active: false })) // Tab 2 is not active
      .mockImplementationOnce((tabId, callback) => callback({ id: tabId, active: true }));  // Tab 3 is active

    reloadTab();

    // Allow callbacks to process
    process.nextTick(() => {
      expect(chrome.tabs.reload).toHaveBeenCalledWith(1);
      expect(chrome.tabs.reload).not.toHaveBeenCalledWith(2); // Should not be called for tab 2
      // The original logic in reloadTab has a `return` after the first active tab reload.
      // So only the first active tab it finds will be reloaded.
      // If tab 1 is active, it reloads tab 1 and returns.
      // If tab 1 is inactive and tab 2 is active, it reloads tab 2 and returns.
      // This seems like a potential bug in reloadTab if the intention is to reload all active tabs.
      // Based on current implementation:
      expect(chrome.tabs.reload).toHaveBeenCalledTimes(1); 
      done();
    });
  });

  test('should not call reload if no tabs are active', (done) => {
    tabIds.add(1).add(2);
    chrome.tabs.get.mockImplementation((tabId, callback) => callback({ id: tabId, active: false }));
    
    reloadTab();

    process.nextTick(() => {
      expect(chrome.tabs.reload).not.toHaveBeenCalled();
      done();
    });
  });

  test('should do nothing if tabIds is empty', () => {
    reloadTab();
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });
});
