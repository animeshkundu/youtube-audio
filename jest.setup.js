// Mock for Chrome Extension APIs

global.chrome = {
  tabs: {
    get: jest.fn((tabId, callback) => {
      // Simulate finding a tab; callback with a mock tab object
      // Modify as needed for specific tests (e.g., active tab)
      if (typeof callback === 'function') {
        callback({ id: tabId, active: true }); // Default to active for reloadTab tests
      }
      return Promise.resolve({ id: tabId, active: true });
    }),
    reload: jest.fn(),
    sendMessage: jest.fn(),
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn(), // Though not explicitly tested for removal
    },
  },
  webRequest: {
    onBeforeRequest: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (typeof callback === 'function') {
          // Simulate storage returning an empty object or specific values based on tests
          callback({}); 
        }
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (typeof callback === 'function') {
          callback();
        }
        return Promise.resolve();
      }),
    },
  },
  browserAction: {
    setIcon: jest.fn(),
    onClicked: {
      addListener: jest.fn((callback) => {
        // Store the callback so we can simulate a click later
        global.chrome.browserAction.onClicked.trigger = callback;
      }),
      removeListener: jest.fn(), // Though not explicitly tested for removal
      trigger: null, // To be set by addListener
    },
  },
  runtime: {
    onMessage: {
      addListener: jest.fn((callback) => {
         // Store the callback so we can simulate a message later
        global.chrome.runtime.onMessage.trigger = callback;
      }),
      removeListener: jest.fn(), // Though not explicitly tested for removal
      trigger: null, // To be set by addListener
    },
    sendMessage: jest.fn(), // Though not explicitly tested
  },
};

// Helper to reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();

  // Reset specific mock implementations for storage.local.get if needed
  global.chrome.storage.local.get.mockImplementation((keys, callback) => {
    if (typeof callback === 'function') {
      callback({}); // Default to empty storage
    }
    return Promise.resolve({});
  });
  
  // Reset specific mock implementations for tabs.get if needed
   global.chrome.tabs.get.mockImplementation((tabId, callback) => {
    if (typeof callback === 'function') {
      callback({ id: tabId, active: true });
    }
    return Promise.resolve({ id: tabId, active: true });
  });

  // Ensure triggers are reset if they were captured
  if (global.chrome.browserAction.onClicked.addListener.mock.calls.length > 0) {
    const lastCall = global.chrome.browserAction.onClicked.addListener.mock.calls.slice(-1)[0];
    global.chrome.browserAction.onClicked.trigger = lastCall[0];
  }
  if (global.chrome.runtime.onMessage.addListener.mock.calls.length > 0) {
     const lastCall = global.chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0];
    global.chrome.runtime.onMessage.trigger = lastCall[0];
  }
});
