/**
 * Jest test setup file
 * Configures Chrome API mocks for browser extension testing
 */

// Mock Chrome API
const createMockStorage = () => {
  let storage = {};
  return {
    get: jest.fn((keys, callback) => {
      if (typeof keys === 'string') {
        callback({ [keys]: storage[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach((key) => {
          result[key] = storage[key];
        });
        callback(result);
      } else {
        callback(storage);
      }
    }),
    set: jest.fn((items, callback) => {
      Object.assign(storage, items);
      if (callback) callback();
    }),
    clear: jest.fn((callback) => {
      storage = {};
      if (callback) callback();
    }),
    _getStorage: () => storage,
    _setStorage: (data) => {
      storage = data;
    },
  };
};

const createMockTabs = () => {
  const tabs = new Map();
  let tabIdCounter = 1;

  return {
    get: jest.fn((tabId, callback) => {
      const tab = tabs.get(tabId) || { id: tabId, active: false };
      callback(tab);
    }),
    reload: jest.fn((_tabId) => {
      // Mock reload
    }),
    sendMessage: jest.fn((tabId, message, callback) => {
      if (callback) callback();
    }),
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    _addTab: (tab) => {
      const id = tab.id || tabIdCounter++;
      tabs.set(id, { id, ...tab });
      return id;
    },
    _getTabs: () => tabs,
    _clearTabs: () => tabs.clear(),
  };
};

const createMockBrowserAction = () => ({
  setIcon: jest.fn(),
  onClicked: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
});

const createMockWebRequest = () => {
  const listeners = [];
  return {
    onBeforeRequest: {
      addListener: jest.fn((callback, filter, extraInfoSpec) => {
        listeners.push({ callback, filter, extraInfoSpec });
      }),
      removeListener: jest.fn((callback) => {
        const index = listeners.findIndex((l) => l.callback === callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }),
      _getListeners: () => listeners,
    },
  };
};

const createMockRuntime = () => ({
  sendMessage: jest.fn(),
  onMessage: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
});

// Create the chrome mock object
global.chrome = {
  storage: {
    local: createMockStorage(),
  },
  tabs: createMockTabs(),
  browserAction: createMockBrowserAction(),
  webRequest: createMockWebRequest(),
  runtime: createMockRuntime(),
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  global.chrome.storage.local = createMockStorage();
  global.chrome.tabs = createMockTabs();
  global.chrome.browserAction = createMockBrowserAction();
  global.chrome.webRequest = createMockWebRequest();
  global.chrome.runtime = createMockRuntime();
});

// Helper to create mock video element
global.createMockVideoElement = () => {
  const video = document.createElement('video');
  video.src = '';
  video.paused = true;
  video.play = jest.fn(() => Promise.resolve());
  video.pause = jest.fn();
  return video;
};

// Helper to simulate DOM ready
global.waitForDom = () => new Promise((resolve) => setTimeout(resolve, 0));
