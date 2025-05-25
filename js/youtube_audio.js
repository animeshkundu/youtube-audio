chrome.runtime.sendMessage('enable-youtube-audio');

let sponsorSegments = [];
let currentVideoId = null;
let videoElement = null;
let lastSkippedSegmentUUID = null; // To prevent immediate re-skip of the same segment

function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
}

async function fetchSponsorSegments(videoId) {
    const apiUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&category=sponsor&category=intro&category=outro&category=selfpromo&category=interaction`;
    try {
        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();
            return data.map(segment => ({ // Ensure we get an array of objects as expected
                UUID: segment.UUID,
                startTime: segment.segment[0],
                endTime: segment.segment[1],
                category: segment.category
            }));
        } else {
            console.error("SponsorBlock API request failed:", response.status, response.statusText);
            return [];
        }
    } catch (error) {
        console.error("Error fetching sponsor segments:", error);
        return [];
    }
}

async function initSponsorSkipping() {
    const videoId = getVideoId();
    if (videoId && videoId !== currentVideoId) {
        currentVideoId = videoId;
        console.log(`Fetching sponsor segments for video ID: ${videoId}`);
        sponsorSegments = await fetchSponsorSegments(videoId);
        console.log("Sponsor segments:", sponsorSegments);

        if (videoElement) { // Remove listener from old video element if any
            videoElement.removeEventListener('timeupdate', checkSponsorSegments);
        }
        
        videoElement = document.querySelector('video'); // Get the primary video element
        if (videoElement) {
            videoElement.addEventListener('timeupdate', checkSponsorSegments);
            lastSkippedSegmentUUID = null; // Reset for new video
        }
    } else if (!videoId) {
        // If not on a video page or video ID is gone
        if (videoElement) {
            videoElement.removeEventListener('timeupdate', checkSponsorSegments);
        }
        currentVideoId = null;
        sponsorSegments = [];
        videoElement = null;
        lastSkippedSegmentUUID = null;
    }
}

function checkSponsorSegments() {
    if (!videoElement || !sponsorSegments || sponsorSegments.length === 0) {
        return;
    }
    const currentTime = videoElement.currentTime;
    for (const segment of sponsorSegments) {
        // Check if current time is within the segment and it's not the segment we just skipped
        if (currentTime > segment.startTime && currentTime < segment.endTime) {
            if (lastSkippedSegmentUUID !== segment.UUID) {
                console.log(`Skipping sponsor segment: ${segment.category} from ${segment.startTime} to ${segment.endTime}`);
                videoElement.currentTime = segment.endTime + 0.25; // Add small buffer
                lastSkippedSegmentUUID = segment.UUID; 
                // When a skip occurs, the timeupdate event will fire again. 
                // We set lastSkippedSegmentUUID to prevent an immediate re-evaluation and potential loop for the same segment.
                // Reset lastSkippedSegmentUUID if current time moves significantly away from the skipped segment
                // or after a short timeout, to allow re-skipping if the user seeks back.
                // For simplicity now, we'll rely on the currentTime moving past endTime.
                // A more robust solution might involve a timeout to clear lastSkippedSegmentUUID.
                break; // Exit loop after skipping one segment
            }
        } else if (currentTime > segment.endTime + 1 && lastSkippedSegmentUUID === segment.UUID) {
            // If playback has moved past the segment we last skipped, clear it so it can be skipped again if needed
            lastSkippedSegmentUUID = null;
        }
    }
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
        let url = request.url;
        let videoElement = document.getElementsByTagName('video')[0];
		videoElement.onloadeddata = makeSetAudioURL(videoElement, url);

        let audioOnlyDivs = document.getElementsByClassName('audio_only_div');
        // Append alert text
        if (audioOnlyDivs.length == 0 && url.includes('mime=audio')) {
            let extensionAlert = document.createElement('div');
            extensionAlert.className = 'audio_only_div';

            let alertText = document.createElement('p');
            alertText.className = 'alert_text';
            alertText.innerHTML = 'Youtube Audio Extension is running. It disables the video stream and uses only the audio stream' +
                ' which saves battery life and bandwidth / data when you just want to listen to just songs. If you want to watch' +
                ' video also, click on the extension icon and refresh your page.';

            extensionAlert.appendChild(alertText);
            let parent = videoElement.parentNode.parentNode;

            // Append alert only if options specify to do so
            chrome.storage.local.get('disable_video_text', function(values) {
              var disableVideoText = (values.disable_video_text ? true : false);
              if (!disableVideoText && parent.getElementsByClassName("audio_only_div").length == 0)
                parent.appendChild(extensionAlert);
            });
        }
        else if (url == "") {
            for(div in audioOnlyDivs) {
                div.parentNode.removeChild(div);
            }
        }
    }
);

// Initial call
initSponsorSkipping();

// Periodically check for navigation changes
setInterval(initSponsorSkipping, 1000);
