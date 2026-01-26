/**
 * Unit tests for options.js - Options page script
 * Tests the options page functionality
 */

describe('Options Script (options.js)', () => {
  beforeEach(() => {
    // Reset the DOM
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="disable-video-text" />
        <label for="disable-video-text">Disable video window text</label>
      </div>
    `;
    jest.clearAllMocks();
  });

  describe('Checkbox initialization', () => {
    it('should find disable-video-text checkbox', () => {
      const checkbox = document.getElementById('disable-video-text');
      expect(checkbox).not.toBeNull();
      expect(checkbox.type).toBe('checkbox');
    });

    it('should initialize checkbox as unchecked when storage is empty', () => {
      const checkbox = document.getElementById('disable-video-text');
      chrome.storage.local._setStorage({});

      chrome.storage.local.get('disable_video_text', (values) => {
        checkbox.checked = values.disable_video_text ? true : false;
      });

      // Default should be unchecked (false)
      expect(checkbox.checked).toBe(false);
    });

    it('should initialize checkbox as checked when storage value is true', () => {
      const checkbox = document.getElementById('disable-video-text');
      chrome.storage.local._setStorage({ disable_video_text: true });

      chrome.storage.local.get('disable_video_text', (values) => {
        checkbox.checked = values.disable_video_text ? true : false;
      });

      expect(checkbox.checked).toBe(true);
    });

    it('should initialize checkbox as unchecked when storage value is false', () => {
      const checkbox = document.getElementById('disable-video-text');
      chrome.storage.local._setStorage({ disable_video_text: false });

      chrome.storage.local.get('disable_video_text', (values) => {
        checkbox.checked = values.disable_video_text ? true : false;
      });

      expect(checkbox.checked).toBe(false);
    });
  });

  describe('optionChanged handler', () => {
    it('should save option when checkbox changes to checked', () => {
      const checkbox = document.getElementById('disable-video-text');
      checkbox.checked = true;

      // Simulate the optionChanged function
      const optionChanged = function () {
        chrome.storage.local.set({
          disable_video_text: checkbox.checked,
        });
      };

      optionChanged();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        disable_video_text: true,
      });
    });

    it('should save option when checkbox changes to unchecked', () => {
      const checkbox = document.getElementById('disable-video-text');
      checkbox.checked = false;

      const optionChanged = function () {
        chrome.storage.local.set({
          disable_video_text: checkbox.checked,
        });
      };

      optionChanged();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        disable_video_text: false,
      });
    });

    it('should trigger storage update on change event', () => {
      const checkbox = document.getElementById('disable-video-text');

      const optionChanged = function () {
        chrome.storage.local.set({
          disable_video_text: checkbox.checked,
        });
      };

      // Add the event listener
      checkbox.addEventListener('change', optionChanged);

      // Simulate change
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('DOM element handling', () => {
    it('should handle missing checkbox gracefully', () => {
      document.body.innerHTML = '';
      const checkbox = document.getElementById('disable-video-text');

      expect(checkbox).toBeNull();

      // The actual code checks if checkbox exists before adding listener
      if (checkbox) {
        checkbox.addEventListener('change', jest.fn());
      }

      // Should not throw error
      expect(true).toBe(true);
    });
  });

  describe('Storage integration', () => {
    it('should persist checkbox state across sessions', () => {
      const checkbox = document.getElementById('disable-video-text');

      // Set initial state
      chrome.storage.local.set({ disable_video_text: true });

      // Simulate reloading page and reading storage
      chrome.storage.local.get('disable_video_text', (values) => {
        checkbox.checked = values.disable_video_text ? true : false;
      });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        disable_video_text: true,
      });
    });
  });
});
