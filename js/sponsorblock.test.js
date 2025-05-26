// Test cases for js/sponsorblock.js using the HTML test runner

(async function() { // Use an async IIFE to allow await for tests

    // --- Test-Specific Mock Configuration ---
    const mockVideo = document.getElementById('testVideo');
    
    // Helper to set window.location.search for getVideoIdSponsorBlock tests
    function setUrlSearch(searchString) {
        // Directly modify window.location.search for the test environment
        // This is a bit of a hack but simplest for browser-based test runner.
        // A more robust way might involve spies if we could intercept URLSearchParams,
        // but sponsorblock.js uses `new URLSearchParams(window.location.search)` directly.
        // So, we must ensure window.location.search is what we want it to be.
        // Note: This won't trigger 'yt-navigate-finish' or real navigation.
        Object.defineProperty(window, 'location', {
            value: {
                ...window.location, // Keep other parts of location
                search: searchString,
                href: `http://www.youtube.com/watch${searchString}` // Ensure href is consistent for URL parsing
            },
            writable: true,
            configurable: true
        });
        // console.log(`[Mocking] window.location.search set to: "${window.location.search}"`);
    }
    
    // Helper to reset mocks and video state before each major test block or individual test
    async function resetMocksAndState() {
        mockStorageData = {}; // Reset storage mock from HTML runner
        await chrome.storage.local.clear(); // Ensure it's cleared
        
        // Reset fetch mock (rely on default from HTML runner or set specific one)
        globalThis.fetch = async (url, options) => {
            // console.log('[Default Test Mock fetch] Called with URL:', url);
            return Promise.resolve({ 
                ok: true, 
                json: () => Promise.resolve([]), // Default to empty segments
                text: () => Promise.resolve('') 
            });
        };

        // Reset video element state
        mockVideo.src = '';
        mockVideo.currentTime = 0;
        mockVideo.pause(); // Ensure it's paused
        
        // Reset sponsorblock.js internal state by re-evaluating it.
        // This is very heavy-handed. Ideally, sponsorblock.js would have a reset function.
        // For now, we assume tests are independent enough or handle shared state.
        // The HTML runner loads sponsorblock.js once. If it needs full reset,
        // we'd have to dynamically remove and re-add the script tag, or use iframes.
        // Given the constraints, we'll test its functions, assuming its internal state
        // is managed by its own logic (initializeSponsorSkipping, deactivateSponsorSkipping).
        // We can manually call these to try and reset state.
        if (typeof deactivateSponsorSkipping === 'function') {
            deactivateSponsorSkipping(); // Try to clean up listeners and state
        }
        currentVideoId = null; // Reset internal state variable if exposed (it's not directly)
        sponsorSegments = [];  // Reset internal state variable if exposed
        videoElement = null;
        lastSkippedSegmentUUID = null;
        isSponsorSkippingActive = false;
    }

    // --- Test Cases ---

    await test("getVideoIdSponsorBlock: Extracts video ID correctly", async () => {
        await resetMocksAndState();
        setUrlSearch("?v=VIDEO_ID_123");
        assert(getVideoIdSponsorBlock() === "VIDEO_ID_123", "Should get 'VIDEO_ID_123'");
        
        setUrlSearch("?foo=bar&v=ANOTHER_ID&baz=qux");
        assert(getVideoIdSponsorBlock() === "ANOTHER_ID", "Should get 'ANOTHER_ID' from multiple params");
        
        setUrlSearch("?foo=bar");
        assert(getVideoIdSponsorBlock() === null, "Should return null if 'v' param is missing");
        
        setUrlSearch("");
        assert(getVideoIdSponsorBlock() === null, "Should return null for empty search string");
    });

    await test("fetchSponsorSegmentsSponsorBlock: Handles API responses", async () => {
        await resetMocksAndState();
        const videoId = 'testVideoId';

        // Test successful fetch with segments
        globalThis.fetch = async (url) => {
            assert(url.includes(videoId), "Fetch URL should contain videoId");
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([{ UUID: 'seg1', segment: [10, 20], category: 'sponsor' }])
            });
        };
        let segments = await fetchSponsorSegmentsSponsorBlock(videoId);
        assert(segments.length === 1 && segments[0].startTime === 10, "Should return segments on success");

        // Test successful fetch with empty segments
        globalThis.fetch = async () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        segments = await fetchSponsorSegmentsSponsorBlock(videoId);
        assert(segments.length === 0, "Should return empty array for no segments");

        // Test API error (response not ok)
        globalThis.fetch = async () => Promise.resolve({ ok: false, status: 500, statusText: "Server Error" });
        segments = await fetchSponsorSegmentsSponsorBlock(videoId);
        assert(segments.length === 0, "Should return empty array on API error");

        // Test network error (fetch throws)
        globalThis.fetch = async () => Promise.reject(new Error("Network Failure"));
        segments = await fetchSponsorSegmentsSponsorBlock(videoId);
        assert(segments.length === 0, "Should return empty array on network failure");
    });
    
    await test("initializeSponsorSkipping: Main logic and settings checks", async () => {
        await resetMocksAndState();
        setUrlSearch("?v=testVid001"); // Set a video ID

        // Case 1: Both settings enabled (default)
        mockStorageData = { sponsor_skipping_enabled: true, youtube_audio_state: true };
        globalThis.fetch = async () => Promise.resolve({ 
            ok: true, 
            json: () => Promise.resolve([{ UUID: 's1', segment: [5, 10], category: 'sponsor' }]) 
        });
        await initializeSponsorSkipping(); // Call directly for test control
        await new Promise(r => setTimeout(r, 50)); // Allow async ops inside to settle
        assert(sponsorSegments.length === 1 && sponsorSegments[0].UUID === 's1', "Should fetch segments when enabled");
        assert(videoElement === mockVideo, "Video element should be set");
        // Note: Checking event listeners directly is hard without spies on addEventListener.
        // We'll infer from checkSponsorSegmentsSponsorBlock tests.

        // Case 2: Sponsor skipping disabled
        await resetMocksAndState(); // Reset state before next case
        setUrlSearch("?v=testVid002");
        mockStorageData = { sponsor_skipping_enabled: false, youtube_audio_state: true };
        globalThis.fetch.mockClear // Assuming fetch is a jest mock from HTML setup, not ideal
           = async () => { throw new Error("Fetch should not be called if sponsor skipping disabled"); };
        await initializeSponsorSkipping();
        await new Promise(r => setTimeout(r, 50));
        assert(sponsorSegments.length === 0, "Should not fetch segments if sponsor skipping disabled");
        assert(videoElement === null || videoElement.listenerCount === 0, "Video element should have no listeners or be null if skipping disabled"); // Approximate check

        // Case 3: Global extension disabled
        await resetMocksAndState();
        setUrlSearch("?v=testVid003");
        mockStorageData = { sponsor_skipping_enabled: true, youtube_audio_state: false };
         globalThis.fetch = async () => { throw new Error("Fetch should not be called if global ext disabled"); };
        await initializeSponsorSkipping();
        await new Promise(r => setTimeout(r, 50));
        assert(sponsorSegments.length === 0, "Should not fetch segments if global extension disabled");
    });

    await test("checkSponsorSegmentsSponsorBlock: Skips segments correctly", async () => {
        await resetMocksAndState();
        setUrlSearch("?v=testVidSkip");
        mockStorageData = { sponsor_skipping_enabled: true, youtube_audio_state: true };
        
        // Manually set up for this test
        videoElement = mockVideo; // Assign the mock video element
        sponsorSegments = [{ UUID: 'skip1', startTime: 5, endTime: 10, category: 'sponsor' }];
        lastSkippedSegmentUUID = null;
        isSponsorSkippingActive = true; // Assume it's active

        mockVideo.currentTime = 7; // Inside the segment
        checkSponsorSegmentsSponsorBlock();
        assert(mockVideo.currentTime > 10 && mockVideo.currentTime < 10.1, `Should skip segment (currentTime: ${mockVideo.currentTime})`);
        
        const skippedUUID = lastSkippedSegmentUUID; // Capture it
        assert(skippedUUID === 'skip1', "lastSkippedSegmentUUID should be set");

        // Should not re-skip immediately
        mockVideo.currentTime = 7; // Simulate being back in segment (e.g., due to event loop)
        lastSkippedSegmentUUID = skippedUUID; // Ensure it's set from previous skip
        checkSponsorSegmentsSponsorBlock();
        assert(mockVideo.currentTime === 7, "Should not re-skip immediately");

        // Should clear lastSkippedSegmentUUID after segment
        mockVideo.currentTime = 11; // Past the segment
        checkSponsorSegmentsSponsorBlock(); // This should clear lastSkippedSegmentUUID
        assert(lastSkippedSegmentUUID === null, "lastSkippedSegmentUUID should be cleared after segment");

        // Should re-skip if user seeks back
        mockVideo.currentTime = 7;
        checkSponsorSegmentsSponsorBlock();
        assert(mockVideo.currentTime > 10 && mockVideo.currentTime < 10.1, "Should re-skip if user seeks back");
    });

    await test("Storage onChanged: Handles settings changes", async () => {
        await resetMocksAndState();
        setUrlSearch("?v=testVidStorage");

        // 1. Initially disabled, then enable sponsor skipping
        mockStorageData = { sponsor_skipping_enabled: false, youtube_audio_state: true };
        await initializeSponsorSkipping(); // Initialize with it disabled
        await new Promise(r => setTimeout(r, 50));
        assert(isSponsorSkippingActive === false, "Initially inactive");
        
        // Simulate change to enable
        const changes = { sponsor_skipping_enabled: { oldValue: false, newValue: true } };
        mockStorageData.sponsor_skipping_enabled = true; // Update mock backing data
        // Manually trigger listeners as chrome.storage.onChanged.addListener is mocked
        storageChangeListeners.forEach(listener => listener(changes, 'local'));
        await new Promise(r => setTimeout(r, 100)); // Allow async ops in listener to settle
        assert(isSponsorSkippingActive === true, "Should activate on storage change to enabled");

        // 2. Initially enabled, then disable via global state
        mockStorageData = { sponsor_skipping_enabled: true, youtube_audio_state: true };
        await initializeSponsorSkipping();
        await new Promise(r => setTimeout(r, 50));
        assert(isSponsorSkippingActive === true, "Initially active for second test part");

        const changes2 = { youtube_audio_state: { oldValue: true, newValue: false } };
        mockStorageData.youtube_audio_state = false;
        storageChangeListeners.forEach(listener => listener(changes2, 'local'));
        await new Promise(r => setTimeout(r, 50));
        assert(isSponsorSkippingActive === false, "Should deactivate on global disable");
    });
    
    await test("yt-navigate-finish: Triggers re-initialization", async () => {
        await resetMocksAndState();
        setUrlSearch("?v=firstVid");
        mockStorageData = { sponsor_skipping_enabled: true, youtube_audio_state: true };
        globalThis.fetch = async (url) => {
            if (url.includes("firstVid")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ UUID: 'fv1', segment: [1,2], cat: 's'}]) });
            if (url.includes("secondVid")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ UUID: 'sv1', segment: [3,4], cat: 's'}]) });
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        };

        await initializeSponsorSkipping(); // For firstVid
        await new Promise(r => setTimeout(r, 50));
        assert(currentVideoId === "firstVid", "currentVideoId should be firstVid");
        assert(sponsorSegments.length === 1 && sponsorSegments[0].UUID === 'fv1', "Segments for firstVid loaded");

        // Simulate navigation
        setUrlSearch("?v=secondVid");
        // Dispatch 'yt-navigate-finish' event
        window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
        await new Promise(r => setTimeout(r, 100)); // Allow time for event and async initializeSponsorSkipping

        assert(currentVideoId === "secondVid", "currentVideoId should be secondVid after navigation");
        assert(sponsorSegments.length === 1 && sponsorSegments[0].UUID === 'sv1', "Segments for secondVid loaded after navigation");
    });

    summary(); // Display summary of results
})();
