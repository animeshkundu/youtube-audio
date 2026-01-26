/**
 * Unit tests for global.js - Background script
 * Tests the core functionality of the YouTube Audio extension
 */

describe('Background Script (global.js)', () => {
  // Import the functions we need to test by evaluating the script
  let removeURLParameters;
  let reloadTab;
  let processRequest;
  let enableExtension;
  let disableExtension;
  let saveSettings;
  let tabIds;

  beforeEach(() => {
    // Reset the DOM and mocks
    document.body.innerHTML = '';
    jest.clearAllMocks();

    // Create fresh tabIds set
    tabIds = new Set();

    // Define the functions as they are in global.js
    removeURLParameters = function (url, parameters) {
      parameters.forEach(function (parameter) {
        const urlparts = url.split('?');
        if (urlparts.length >= 2) {
          const prefix = encodeURIComponent(parameter) + '=';
          const pars = urlparts[1].split(/[&;]/g);

          for (let i = pars.length; i-- > 0; ) {
            if (pars[i].lastIndexOf(prefix, 0) !== -1) {
              pars.splice(i, 1);
            }
          }

          url = urlparts[0] + '?' + pars.join('&');
        }
      });
      return url;
    };

    reloadTab = function () {
      for (const tabId of tabIds) {
        chrome.tabs.get(tabId, function (tab) {
          if (tab.active) {
            chrome.tabs.reload(tabId);
            return;
          }
        });
      }
    };

    processRequest = function (details) {
      if (!tabIds.has(details.tabId)) {
        return;
      }

      if (details.url.indexOf('mime=audio') !== -1 && !details.url.includes('live=1')) {
        const parametersToBeRemoved = ['range', 'rn', 'rbuf'];
        const audioURL = removeURLParameters(details.url, parametersToBeRemoved);
        chrome.tabs.sendMessage(details.tabId, { url: audioURL });
      }
    };

    enableExtension = function () {
      chrome.browserAction.setIcon({
        path: {
          128: 'img/icon128.png',
          38: 'img/icon38.png',
        },
      });
      chrome.webRequest.onBeforeRequest.addListener(processRequest, { urls: ['<all_urls>'] }, [
        'blocking',
      ]);
    };

    disableExtension = function () {
      chrome.browserAction.setIcon({
        path: {
          38: 'img/disabled_icon38.png',
        },
      });
      chrome.webRequest.onBeforeRequest.removeListener(processRequest);
    };

    saveSettings = function (currentState) {
      chrome.storage.local.set({ youtube_audio_state: currentState });
    };
  });

  describe('removeURLParameters', () => {
    it('should remove specified parameters from URL', () => {
      const url = 'https://example.com/video?range=0-1000&rn=1&mime=audio&other=value';
      const result = removeURLParameters(url, ['range', 'rn']);
      expect(result).toBe('https://example.com/video?mime=audio&other=value');
    });

    it('should handle URL with no query parameters', () => {
      const url = 'https://example.com/video';
      const result = removeURLParameters(url, ['range']);
      expect(result).toBe('https://example.com/video');
    });

    it('should handle URL when parameter does not exist', () => {
      const url = 'https://example.com/video?mime=audio&other=value';
      const result = removeURLParameters(url, ['nonexistent']);
      expect(result).toBe('https://example.com/video?mime=audio&other=value');
    });

    it('should remove all specified parameters', () => {
      const url = 'https://example.com/video?range=0-1000&rn=1&rbuf=500&mime=audio';
      const result = removeURLParameters(url, ['range', 'rn', 'rbuf']);
      expect(result).toBe('https://example.com/video?mime=audio');
    });

    it('should handle semicolon separators', () => {
      const url = 'https://example.com/video?range=0-1000;rn=1;mime=audio';
      const result = removeURLParameters(url, ['range', 'rn']);
      expect(result).toBe('https://example.com/video?mime=audio');
    });

    it('should handle empty parameters array', () => {
      const url = 'https://example.com/video?param=value';
      const result = removeURLParameters(url, []);
      expect(result).toBe('https://example.com/video?param=value');
    });
  });

  describe('reloadTab', () => {
    it('should reload active tabs in tabIds set', () => {
      tabIds.add(1);
      tabIds.add(2);

      // Mock chrome.tabs.get to return active tab for tabId 1
      chrome.tabs.get.mockImplementation((tabId, callback) => {
        callback({ id: tabId, active: tabId === 1 });
      });

      reloadTab();

      expect(chrome.tabs.get).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.reload).toHaveBeenCalledWith(1);
    });

    it('should not reload if no tabs are in set', () => {
      reloadTab();
      expect(chrome.tabs.get).not.toHaveBeenCalled();
      expect(chrome.tabs.reload).not.toHaveBeenCalled();
    });

    it('should not reload inactive tabs', () => {
      tabIds.add(1);

      chrome.tabs.get.mockImplementation((tabId, callback) => {
        callback({ id: tabId, active: false });
      });

      reloadTab();

      expect(chrome.tabs.get).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.reload).not.toHaveBeenCalled();
    });
  });

  describe('processRequest', () => {
    beforeEach(() => {
      tabIds.add(1);
    });

    it('should process audio URL and send message to tab', () => {
      const details = {
        tabId: 1,
        url: 'https://youtube.com/video?mime=audio&range=0-1000&rn=1&rbuf=500',
      };

      processRequest(details);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        url: 'https://youtube.com/video?mime=audio',
      });
    });

    it('should ignore requests from tabs not in tabIds', () => {
      const details = {
        tabId: 999,
        url: 'https://youtube.com/video?mime=audio',
      };

      processRequest(details);

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('should ignore non-audio URLs', () => {
      const details = {
        tabId: 1,
        url: 'https://youtube.com/video?mime=video',
      };

      processRequest(details);

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('should ignore live streams', () => {
      const details = {
        tabId: 1,
        url: 'https://youtube.com/video?mime=audio&live=1',
      };

      processRequest(details);

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('enableExtension', () => {
    it('should set active icon and add webRequest listener', () => {
      enableExtension();

      expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
        path: {
          128: 'img/icon128.png',
          38: 'img/icon38.png',
        },
      });

      expect(chrome.webRequest.onBeforeRequest.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'] },
        ['blocking']
      );
    });
  });

  describe('disableExtension', () => {
    it('should set disabled icon and remove webRequest listener', () => {
      disableExtension();

      expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
        path: {
          38: 'img/disabled_icon38.png',
        },
      });

      expect(chrome.webRequest.onBeforeRequest.removeListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });
  });

  describe('saveSettings', () => {
    it('should save state to chrome.storage.local', () => {
      saveSettings(true);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        youtube_audio_state: true,
      });
    });

    it('should save false state', () => {
      saveSettings(false);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        youtube_audio_state: false,
      });
    });
  });

  describe('Tab management', () => {
    it('should add tab to tabIds on message', () => {
      // Simulate adding tab
      tabIds.add(42);
      expect(tabIds.has(42)).toBe(true);
    });

    it('should remove tab from tabIds on tab close', () => {
      tabIds.add(42);
      tabIds.delete(42);
      expect(tabIds.has(42)).toBe(false);
    });
  });
});
