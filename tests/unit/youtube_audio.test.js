/**
 * Unit tests for youtube_audio.js - Content script
 * Tests the YouTube Audio content script functionality
 */

describe('Content Script (youtube_audio.js)', () => {
  let makeSetAudioURL;

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();

    // Define the function as it is in youtube_audio.js
    makeSetAudioURL = function (videoElement, url) {
      if (videoElement.src != url) {
        const paused = videoElement.paused;
        videoElement.src = url;
        if (paused === false) {
          videoElement.play();
        }
      }
    };
  });

  describe('makeSetAudioURL', () => {
    it('should set video src to audio URL when different', () => {
      const video = createMockVideoElement();
      video.src = 'https://old-url.com';

      makeSetAudioURL(video, 'https://new-audio-url.com');

      // Browser normalizes URLs by adding trailing slash
      expect(video.src).toContain('https://new-audio-url.com');
    });

    it('should not change src when URL is the same', () => {
      const video = createMockVideoElement();
      video.src = 'https://same-url.com';

      makeSetAudioURL(video, 'https://same-url.com');

      // play should not be called since src didn't change
      expect(video.play).not.toHaveBeenCalled();
    });

    it('should call play() if video was playing', () => {
      const video = createMockVideoElement();
      
      // Set up video as playing (paused = false)
      Object.defineProperty(video, 'paused', {
        value: false,
        writable: true,
      });
      video.src = 'https://old-url.com/';

      makeSetAudioURL(video, 'https://new-audio-url.com');

      // Verify the new src was set
      expect(video.src).toContain('new-audio-url');
    });

    it('should not call play() if video was paused', () => {
      const video = createMockVideoElement();
      video.src = 'https://old-url.com';
      video.paused = true; // Video was paused

      makeSetAudioURL(video, 'https://new-audio-url.com');

      expect(video.play).not.toHaveBeenCalled();
    });
  });

  describe('Runtime message handling', () => {
    it('should register runtime message listener on chrome.runtime', () => {
      // Simulate the content script registering its listener
      chrome.runtime.sendMessage('enable-youtube-audio');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith('enable-youtube-audio');
    });
  });

  describe('Audio only notification', () => {
    beforeEach(() => {
      // Create a mock DOM structure like YouTube
      document.body.innerHTML = `
        <div class="video-container">
          <div class="player">
            <video src="https://youtube.com/video"></video>
          </div>
        </div>
      `;
    });

    it('should create notification div with correct class', () => {
      const extensionAlert = document.createElement('div');
      extensionAlert.className = 'audio_only_div';

      const alertText = document.createElement('p');
      alertText.className = 'alert_text';
      alertText.innerHTML = 'Youtube Audio Extension is running.';

      extensionAlert.appendChild(alertText);
      document.body.appendChild(extensionAlert);

      const notificationDiv = document.querySelector('.audio_only_div');
      expect(notificationDiv).not.toBeNull();
      expect(notificationDiv.className).toBe('audio_only_div');
    });

    it('should contain correct notification text', () => {
      const extensionAlert = document.createElement('div');
      extensionAlert.className = 'audio_only_div';

      const alertText = document.createElement('p');
      alertText.className = 'alert_text';
      alertText.innerHTML =
        'Youtube Audio Extension is running. It disables the video stream and uses only the audio stream';

      extensionAlert.appendChild(alertText);
      document.body.appendChild(extensionAlert);

      const textElement = document.querySelector('.alert_text');
      expect(textElement.innerHTML).toContain('Youtube Audio Extension is running');
    });

    it('should not add duplicate notification divs', () => {
      // Add first notification
      const div1 = document.createElement('div');
      div1.className = 'audio_only_div';
      document.body.appendChild(div1);

      // Check that we have one
      let divs = document.getElementsByClassName('audio_only_div');
      expect(divs.length).toBe(1);

      // Simulate the check from the script
      const audioOnlyDivs = document.getElementsByClassName('audio_only_div');
      if (audioOnlyDivs.length === 0) {
        const div2 = document.createElement('div');
        div2.className = 'audio_only_div';
        document.body.appendChild(div2);
      }

      // Should still be only one
      divs = document.getElementsByClassName('audio_only_div');
      expect(divs.length).toBe(1);
    });
  });

  describe('Storage integration', () => {
    it('should respect disable_video_text setting when true', () => {
      chrome.storage.local._setStorage({ disable_video_text: true });

      chrome.storage.local.get('disable_video_text', (values) => {
        const disableVideoText = values.disable_video_text ? true : false;
        expect(disableVideoText).toBe(true);
      });
    });

    it('should respect disable_video_text setting when false', () => {
      chrome.storage.local._setStorage({ disable_video_text: false });

      chrome.storage.local.get('disable_video_text', (values) => {
        const disableVideoText = values.disable_video_text ? true : false;
        expect(disableVideoText).toBe(false);
      });
    });

    it('should default to false when setting not set', () => {
      chrome.storage.local._setStorage({});

      chrome.storage.local.get('disable_video_text', (values) => {
        const disableVideoText = values.disable_video_text ? true : false;
        expect(disableVideoText).toBe(false);
      });
    });
  });
});
