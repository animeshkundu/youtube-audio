// This script is now focused on the audio-only mode functionality.
// SponsorBlock logic has been moved to js/sponsorblock.js

chrome.runtime.sendMessage('enable-youtube-audio'); // Inform background script this content script is active

function getCurrentVideoIdForThumbnail() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
}

var makeSetAudioURL = function(videoElement, url) {
    if (videoElement.src != url) {
		var paused = videoElement.paused;
        videoElement.src = url;
		if (paused === false) {
			videoElement.play();
		}
    }
};

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        // Ensure the message is intended for this script (optional, but good practice)
        if (request.hasOwnProperty('url')) { 
            let url = request.url;
            // It's possible multiple video elements exist, especially with previews or ads.
            // Try to get the main video element.
            let videoElement = document.querySelector('video.html5-main-video');
            if (!videoElement) {
                // Fallback for embedded videos or different YouTube UI
                const videoElements = document.getElementsByTagName('video');
                if (videoElements.length > 0) {
                    videoElement = videoElements[0]; // Assume the first one is the main one
                }
            }

            if (videoElement) {
                // Check if onloadeddata already has our function to prevent multiple assignments if message comes rapidly
                if (videoElement.onloadeddata !== makeSetAudioURL) { // Compare function references
                    videoElement.onloadeddata = function() { // Wrap to ensure correct execution context
                        makeSetAudioURL(videoElement, url);
                    };
                }
                // Call directly in case data is already loaded or src change itself triggers logic
                makeSetAudioURL(videoElement, url); 


                let audioOnlyDivs = document.getElementsByClassName('audio_only_div');
                // Append alert text or thumbnail
                if (audioOnlyDivs.length == 0 && url.includes('mime=audio')) {
                    let extensionAlert = document.createElement('div');
                    extensionAlert.className = 'audio_only_div';
                    extensionAlert.innerHTML = ''; // Clear previous contents

                    const videoId = getCurrentVideoIdForThumbnail();
                    let thumbnailUrl = null;
                    if (videoId) {
                        thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                    }

                    if (thumbnailUrl) {
                        let albumArtImg = document.createElement('img');
                        albumArtImg.src = thumbnailUrl;
                        albumArtImg.style.display = 'block';
                        albumArtImg.style.maxWidth = '80%';
                        albumArtImg.style.maxHeight = '250px';
                        albumArtImg.style.margin = '20px auto';
                        albumArtImg.style.borderRadius = '8px';
                        extensionAlert.appendChild(albumArtImg);
                    }
                    
                    let alertText = document.createElement('p');
                    alertText.className = 'alert_text';
                    if (thumbnailUrl) {
                        alertText.innerHTML = 'Audio-only mode. Video stream disabled to save resources.';
                    } else {
                        alertText.innerHTML = 'Youtube Audio Extension is running. It disables the video stream and uses only the audio stream' +
                            ' which saves battery life and bandwidth / data when you just want to listen to just songs. If you want to watch' +
                            ' video also, click on the extension icon and refresh your page.';
                    }
                    extensionAlert.appendChild(alertText);
                    
                    // Try to find a good parent for the alert.
                    // videoElement.parentNode.parentNode might be too generic or change.
                    // A more stable approach might be to find a known YouTube UI container.
                    let parent = videoElement.closest('#movie_player') || videoElement.parentNode.parentNode;
                    if (parent) {
                         // Append alert only if options specify to do so
                        chrome.storage.local.get('disable_video_text', function(values) {
                        var disableVideoText = (values.disable_video_text ? true : false);
                        if (!disableVideoText && parent.getElementsByClassName("audio_only_div").length == 0)
                            parent.appendChild(extensionAlert);
                        });
                    } else {
                        // console.warn("Youtube Audio: Could not find a suitable parent to append the alert message.");
                    }

                } else if (url == "" && audioOnlyDivs.length > 0) { // If URL is empty string, it means revert to video
                    for (let i = audioOnlyDivs.length - 1; i >= 0; i--) {
                        audioOnlyDivs[i].parentNode.removeChild(audioOnlyDivs[i]);
                    }
                }
            } else {
                // console.warn("Youtube Audio: No video element found on the page to set audio URL.");
            }
        }
    }
);

// console.log("Youtube Audio (audio-only mode) content script loaded.");
