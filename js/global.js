const tabIds = new Set();

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const FANBOY_ANNOYANCE_URL = 'https://easylist.to/easylist/fanboy-annoyance.txt';
const ADBLOCK_CACHE_KEY = 'adblock_patterns_cache';
const ADBLOCK_TIMESTAMP_KEY = 'adblock_patterns_timestamp';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

let activeAdblockPatterns = [];

async function fetchAndParseList(listUrl) {
    try {
        const response = await fetch(listUrl);
        if (!response.ok) {
            console.error(`Failed to fetch ${listUrl}: ${response.status} ${response.statusText}`);
            return [];
        }
        const text = await response.text();
        const lines = text.split('\n');
        const filters = lines
            .filter(line => !line.startsWith('!') && !line.startsWith('#') && line.trim() !== '') // Remove comments, element rules, empty lines
            .filter(line => !line.includes('##') && !line.includes('#@#') && !line.includes('#?#')) // More specific element/exception rules
            // Basic filter: keep lines that seem like network filters.
            // This is a simplification. Real Adblock parsing is more complex.
            // For now, we are mostly interested in domain names or path fragments.
            .map(line => {
                line = line.trim();
                if (line.startsWith('||') && line.endsWith('^')) {
                    // Handles ||domain.com^
                    // Extracts 'domain.com'
                    return { type: 'domain', value: line.substring(2, line.length - 1).split('/')[0] };
                } else if (line.startsWith('||')) {
                    // Handles ||domain.com/path
                    // Extracts 'domain.com/path' - treat as a specific kind of url_part or a more complex domain rule
                    // For simplicity, let's treat as a domain-specific path
                     return { type: 'domain_path', value: line.substring(2) };
                } else if (line.includes('*')) {
                    // Basic wildcard, store as is, to be converted to regex in processRequest
                    return { type: 'wildcard', value: line };
                } else if (line.startsWith('/') && line.endsWith('/')) {
                    // Regex-like patterns (e.g., /banner\d+\.gif$/) - these are complex
                    // For now, treat as wildcard or skip if too complex
                    // Let's treat as wildcard for now, assuming simple regex might be intended
                    return { type: 'wildcard', value: line }; 
                } else if (line.includes('/') || line.includes('.')) {
                    // Standard URL part or specific domain/path that isn't a domain anchor rule
                    // e.g., adserver.com/ads.js or /ads/banner.gif
                    return { type: 'url_part', value: line };
                }
                // Other rules might be too complex or not network filters (e.g. element hiding exceptions)
                return null; 
            })
            .filter(pattern => pattern !== null && pattern.value && pattern.value.length > 3); // Filter out nulls and very short/empty values
        
        console.log(`Fetched and parsed ${filters.length} structured filters from ${listUrl}`);
        return filters;
    } catch (error) {
        console.error(`Error fetching or parsing ${listUrl}:`, error);
        return [];
    }
}

async function updateAdblockLists() {
    console.log('Starting adblock list update...');
    try {
        const easylistFilters = await fetchAndParseList(EASYLIST_URL);
        const fanboyFilters = await fetchAndParseList(FANBOY_ANNOYANCE_URL);
        
        const combinedFilters = [...new Set([...easylistFilters, ...fanboyFilters])]; // Combine and remove duplicates
        
        await new Promise(resolve => {
            chrome.storage.local.set({
                [ADBLOCK_CACHE_KEY]: combinedFilters,
                [ADBLOCK_TIMESTAMP_KEY]: Date.now()
            }, () => {
                console.log(`Adblock patterns updated and cached. Total patterns: ${combinedFilters.length}`);
                activeAdblockPatterns = combinedFilters; // Update active patterns
                resolve();
            });
        });
        return true;
    } catch (error) {
        console.error('Failed to update adblock lists:', error);
        return false;
    }
}

async function loadAdblockPatterns() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get([ADBLOCK_CACHE_KEY, ADBLOCK_TIMESTAMP_KEY], resolve);
        });

        const cachedPatterns = result[ADBLOCK_CACHE_KEY];
        const lastUpdated = result[ADBLOCK_TIMESTAMP_KEY];

        if (cachedPatterns && lastUpdated && (Date.now() - lastUpdated < STALE_THRESHOLD_MS)) {
            console.log('Loading adblock patterns from fresh cache.');
            activeAdblockPatterns = cachedPatterns;
        } else {
            if (!cachedPatterns) {
                console.log('No adblock patterns in cache. Fetching new lists.');
            } else {
                console.log('Adblock patterns cache is stale. Fetching new lists.');
            }
            await updateAdblockLists();
        }
    } catch (error) {
        console.error('Error loading adblock patterns:', error);
        // Fallback or default behavior if loading fails
        activeAdblockPatterns = []; // Ensure it's an array
        // Optionally, try to update again or use a small default list
        console.log('Attempting to fetch lists as a fallback...');
        await updateAdblockLists(); 
    }
    console.log(`Adblock patterns loaded. Total patterns: ${activeAdblockPatterns.length}`);
}

function removeURLParameters(url, parameters) {
    parameters.forEach(function(parameter) {
        var urlparts = url.split('?');
        if (urlparts.length >= 2) {
            var prefix = encodeURIComponent(parameter) + '=';
            var pars = urlparts[1].split(/[&;]/g);

            for (var i = pars.length; i-- > 0;) {
                if (pars[i].lastIndexOf(prefix, 0) !== -1) {
                    pars.splice(i, 1);
                }
            }

            url = urlparts[0] + '?' + pars.join('&');
        }
    });
    return url;
}

function reloadTab() {
	for (const tabId of tabIds) {
		chrome.tabs.get(tabId, function(tab) {
			if (tab.active) {
				chrome.tabs.reload(tabId);
				return;
			}
		});
	}
}

function processRequest(details) {
	if (!tabIds.has(details.tabId)) {
		return;
	}

    // Use activeAdblockPatterns (dynamically loaded with structured objects)
    for (const pattern of activeAdblockPatterns) {
        try {
            if (pattern.type === 'domain') {
                // Match pattern.value against the hostname of details.url
                // It should match pattern.value OR *.pattern.value
                const requestHostname = new URL(details.url).hostname;
                if (requestHostname === pattern.value || requestHostname.endsWith(`.${pattern.value}`)) {
                    // console.log(`Blocking ${details.url} due to domain pattern: ${pattern.value}`);
                    return { cancel: true };
                }
            } else if (pattern.type === 'domain_path') {
                // Matches if URL starts with http(s)://domain.com/path
                // e.g. pattern.value = "example.com/adpath"
                // details.url = "http://example.com/adpath/script.js"
                const simplifiedUrl = details.url.replace(/^https?:\/\//, '');
                if (simplifiedUrl.startsWith(pattern.value)) {
                    // console.log(`Blocking ${details.url} due to domain_path pattern: ${pattern.value}`);
                    return { cancel: true };
                }
            } else if (pattern.type === 'url_part') {
                if (details.url.includes(pattern.value)) {
                    // console.log(`Blocking ${details.url} due to url_part pattern: ${pattern.value}`);
                    return { cancel: true };
                }
            } else if (pattern.type === 'wildcard') {
                // Convert simple wildcard to regex: escape special chars, replace * with .*?
                // This is a basic implementation. ABP wildcards can be more complex.
                // Example: *banner=true*  ->  /.*?banner=true.*?/
                // Example: ads*.example.com -> /^https?:\/\/ads.*?\.example\.com/ (more specific if it implies start of domain)
                // For now, a general includes-style wildcard:
                let regexPattern = pattern.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars
                regexPattern = regexPattern.replace(/\*/g, '.*?'); // Replace * with .*?
                
                // Handle cases like /regex/i by trying to parse them if they are at start/end
                if (regexPattern.startsWith('/') && regexPattern.endsWith('/')) {
                    try {
                        const regex = new RegExp(regexPattern.slice(1, -1));
                        if (regex.test(details.url)) {
                            // console.log(`Blocking ${details.url} due to regex (from wildcard) pattern: ${pattern.value}`);
                            return { cancel: true };
                        }
                    } catch (e) {
                        // console.warn(`Invalid regex from wildcard: ${pattern.value}`, e);
                        // Fallback to simple includes if regex fails to compile from complex wildcard
                        if (details.url.includes(pattern.value.replace(/\*/g, ''))) { // basic check without wildcard
                             // console.log(`Blocking ${details.url} due to fallback wildcard pattern: ${pattern.value}`);
                             return {cancel: true};
                        }
                    }
                } else {
                     // Treat as a simple wildcard includes
                    const regex = new RegExp(regexPattern);
                    if (regex.test(details.url)) {
                        // console.log(`Blocking ${details.url} due to wildcard pattern: ${pattern.value}`);
                        return { cancel: true };
                    }
                }
            }
        } catch (e) {
            // If URL parsing fails or any other error during matching, log it and continue
            // console.error("Error matching pattern:", pattern, "for URL:", details.url, e);
        }
    }

    if (details.url.indexOf('mime=audio') !== -1 && !details.url.includes('live=1')) {
        var parametersToBeRemoved = ['range', 'rn', 'rbuf'];
        var audioURL = removeURLParameters(details.url, parametersToBeRemoved);
        chrome.tabs.sendMessage(details.tabId, {url: audioURL});
    }
}

function enableExtension() {
    chrome.browserAction.setIcon({
        path : {
            128 : "img/icon128.png",
            38 : "img/icon38.png"
        }
    });
    chrome.webRequest.onBeforeRequest.addListener(
        processRequest,
        {urls: [
            "*://*.youtube.com/*",
            "*://*.youtube-nocookie.com/*",
            "*://*.doubleclick.net/*",
            "*://*.googlesyndication.com/*",
            "*://*.googleads.g.doubleclick.net/*",
            "*://*.stats.g.doubleclick.net/*"
        ]},
        ["blocking"]
    );
}

function disableExtension() {
    chrome.browserAction.setIcon({
        path : {
            38 : "img/disabled_icon38.png",
        }
    });
    chrome.webRequest.onBeforeRequest.removeListener(processRequest);
}

function saveSettings(currentState) {
    chrome.storage.local.set({'youtube_audio_state': currentState});
}

chrome.browserAction.onClicked.addListener(function() {
    chrome.storage.local.get('youtube_audio_state', function(values) {
        var currentState = values.youtube_audio_state;
		var newState = !currentState;

        if (newState) {
            enableExtension();
        } else {
            disableExtension();
        }

        saveSettings(newState);
		reloadTab();
    });
});

chrome.storage.local.get('youtube_audio_state', function(values) {
    var currentState = values.youtube_audio_state;
    if (typeof currentState === "undefined") {
        currentState = true;
        saveSettings(currentState);
    }

    if (currentState) {
        enableExtension();
    } else {
        disableExtension();
    }
});

chrome.runtime.onMessage.addListener(function(message, sender) {
	tabIds.add(sender.tab.id);
});

chrome.tabs.onRemoved.addListener(function(tabId) {
	tabIds.delete(tabId);
});

// Initial load of adblock patterns
loadAdblockPatterns();
