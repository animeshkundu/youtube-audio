// --- SponsorBlock Logic ---

let sponsorSegments = [];
let currentVideoId = null;
let videoElement = null; // The main video element on the page
let lastSkippedSegmentUUID = null;
let isSponsorSkippingActive = false; // Flag to track active state

function getVideoIdSponsorBlock() { // Renamed to avoid potential global scope conflicts if ever combined
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
}

async function fetchSponsorSegmentsSponsorBlock(videoId) { // Renamed
    const categories = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic'];
    const apiUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${JSON.stringify(categories)}`;
    
    try {
        const response = await fetch(apiUrl, { method: 'GET', mode: 'cors' });
        if (response.ok) {
            const data = await response.json();
            // Ensure data is an array and segments have the required structure
            if (Array.isArray(data)) {
                return data.map(segment => ({
                    UUID: segment.UUID,
                    startTime: segment.segment[0],
                    endTime: segment.segment[1],
                    category: segment.category
                }));
            } else {
                console.error("SponsorBlock API response is not an array:", data);
                return [];
            }
        } else {
            console.error("SponsorBlock API request failed:", response.status, response.statusText);
            return [];
        }
    } catch (error) {
        console.error("Error fetching/parsing sponsor segments:", error);
        return [];
    }
}

function checkSponsorSegmentsSponsorBlock() { // Renamed
    if (!videoElement || videoElement.readyState < 1 || !sponsorSegments || sponsorSegments.length === 0) { // videoElement.readyState < 1 means no metadata yet
        return;
    }
    const currentTime = videoElement.currentTime;
    for (const segment of sponsorSegments) {
        if (currentTime > segment.startTime && currentTime < segment.endTime) {
            if (lastSkippedSegmentUUID !== segment.UUID) {
                console.log(`SponsorBlock: Skipping ${segment.category} segment from ${segment.startTime} to ${segment.endTime}`);
                videoElement.currentTime = segment.endTime + 0.01; // Small buffer to ensure it's past the segment
                lastSkippedSegmentUUID = segment.UUID; 
                break; 
            }
        } else if (currentTime >= segment.endTime && lastSkippedSegmentUUID === segment.UUID) {
            // If playback has moved past or is at the end of the segment we last skipped, clear it
            lastSkippedSegmentUUID = null;
        }
    }
}

async function initializeSponsorSkipping() {
    chrome.storage.local.get(['sponsor_skipping_enabled', 'youtube_audio_state'], async function(items) {
        const sponsorSkippingEnabled = items.sponsor_skipping_enabled !== undefined ? items.sponsor_skipping_enabled : true;
        const globalExtensionEnabled = items.youtube_audio_state !== undefined ? items.youtube_audio_state : true;

        if (!sponsorSkippingEnabled || !globalExtensionEnabled) {
            // console.log("SponsorBlock: Deactivating due to settings (sponsor_skipping_enabled:", sponsorSkippingEnabled, ", youtube_audio_state:", globalExtensionEnabled, ")");
            deactivateSponsorSkipping();
            return;
        }
        
        isSponsorSkippingActive = true; // Set flag
        // console.log("SponsorBlock: Initializing for current page (settings allow)...");
        const videoId = getVideoIdSponsorBlock();

        if (videoId && videoId === currentVideoId && videoElement) { // Also check if videoElement is still valid
            // console.log("SponsorBlock: Video ID unchanged, already initialized or fetching for:", videoId);
            return; 
        }
        
        // If videoId is null or different, reset state for the old video (if any)
        if (videoElement) {
            videoElement.removeEventListener('timeupdate', checkSponsorSegmentsSponsorBlock);
        }
        currentVideoId = videoId; 
        sponsorSegments = [];
        videoElement = null; 
        lastSkippedSegmentUUID = null;

        if (videoId) {
            // console.log(`SponsorBlock: New video ID: ${videoId}. Fetching segments.`);
            sponsorSegments = await fetchSponsorSegmentsSponsorBlock(videoId);

            videoElement = document.querySelector('video.html5-main-video');
            if (!videoElement) {
                videoElement = document.querySelector('video');
            }

            if (videoElement) {
                videoElement.addEventListener('timeupdate', checkSponsorSegmentsSponsorBlock);
                lastSkippedSegmentUUID = null; 
            } else {
                // console.log("SponsorBlock: Video element not found for ID:", videoId);
            }
        } else {
            // console.log("SponsorBlock: No video ID found on this page. Clearing state.");
            deactivateSponsorSkipping(); // Ensure cleanup if navigating to non-video page
        }
    });
}

function deactivateSponsorSkipping() {
    // console.log("SponsorBlock: Deactivating and cleaning up listeners/state.");
    if (videoElement) {
        videoElement.removeEventListener('timeupdate', checkSponsorSegmentsSponsorBlock);
    }
    sponsorSegments = [];
    // currentVideoId = null; // Keep currentVideoId to prevent re-initialization on same non-video page if settings change back and forth
    lastSkippedSegmentUUID = null;
    videoElement = null; // Ensure we re-query for video element if reactivated
    isSponsorSkippingActive = false;
}

// --- Initialization, Storage Change Listener, and SPA Navigation Handling ---

// Initial call to set up for the current page
initializeSponsorSkipping();

chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && (changes.sponsor_skipping_enabled || changes.youtube_audio_state)) {
        // console.log("SponsorBlock: Settings changed, re-evaluating initialization.");
        // Re-fetch current values to make decision
        chrome.storage.local.get(['sponsor_skipping_enabled', 'youtube_audio_state'], function(items) {
            const sponsorSkippingEnabled = items.sponsor_skipping_enabled !== undefined ? items.sponsor_skipping_enabled : true;
            const globalExtensionEnabled = items.youtube_audio_state !== undefined ? items.youtube_audio_state : true;

            if (sponsorSkippingEnabled && globalExtensionEnabled) {
                if (!isSponsorSkippingActive) { // Only re-initialize if it was previously inactive
                    // console.log("SponsorBlock: Reactivating due to settings change.");
                    initializeSponsorSkipping(); // This will re-check videoId and settings
                }
            } else {
                // console.log("SponsorBlock: Deactivating due to settings change.");
                deactivateSponsorSkipping();
            }
        });
    }
});

// YouTube uses SPA navigation (History API). We need to detect URL changes.
// A common way is to listen for 'yt-navigate-finish' or use MutationObserver.
// For simplicity and robustness across potential YouTube UI changes,
// a periodic check is fallback, but 'yt-navigate-finish' is preferred.

// Attempt to use YouTube's specific navigation event
// This event is fired by YouTube after a page navigation (including SPA) has completed.
window.addEventListener('yt-navigate-finish', (event) => {
    // console.log("SponsorBlock: 'yt-navigate-finish' event detected.");
    // The event itself might carry the new URL or page data, but getVideoIdSponsorBlock will re-parse window.location
    initializeSponsorSkipping();
});

// Fallback: If 'yt-navigate-finish' isn't reliable or for some edge cases,
// a less efficient periodic check might be needed, but it's generally discouraged.
// For now, relying on 'yt-navigate-finish'. If issues arise, this could be a place to add a setInterval fallback.
// Example fallback (generally avoid if 'yt-navigate-finish' works):
// setInterval(initializeSponsorSkipping, 2000); // Check every 2 seconds

console.log("SponsorBlock content script loaded and initialized.");
