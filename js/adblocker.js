// --- Adblocker Logic ---

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
            .filter(line => !line.startsWith('!') && !line.startsWith('#') && line.trim() !== '')
            .filter(line => !line.includes('##') && !line.includes('#@#') && !line.includes('#?#'))
            .map(line => {
                line = line.trim();
                if (line.startsWith('||') && line.endsWith('^')) {
                    return { type: 'domain', value: line.substring(2, line.length - 1).split('/')[0] };
                } else if (line.startsWith('||')) {
                    return { type: 'domain_path', value: line.substring(2) };
                } else if (line.includes('*')) {
                    return { type: 'wildcard', value: line };
                } else if (line.startsWith('/') && line.endsWith('/')) {
                    return { type: 'wildcard', value: line }; 
                } else if (line.includes('/') || line.includes('.')) {
                    return { type: 'url_part', value: line };
                }
                return null; 
            })
            .filter(pattern => pattern !== null && pattern.value && pattern.value.length > 3);
        
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
        
        // Combine and remove duplicates. Using a Set of stringified objects for simplicity with structured patterns.
        // For more robust duplicate checking with objects, a more complex approach might be needed
        // or ensure that `value` itself is unique enough for common cases.
        const combinedFiltersMap = new Map();
        [...easylistFilters, ...fanboyFilters].forEach(filter => {
            combinedFiltersMap.set(JSON.stringify(filter), filter); // Simple way to unique objects by their string form
        });
        const combinedFilters = Array.from(combinedFiltersMap.values());

        await new Promise(resolve => {
            chrome.storage.local.set({
                [ADBLOCK_CACHE_KEY]: combinedFilters,
                [ADBLOCK_TIMESTAMP_KEY]: Date.now()
            }, () => {
                console.log(`Adblock patterns updated and cached. Total patterns: ${combinedFilters.length}`);
                activeAdblockPatterns = combinedFilters;
                resolve();
            });
        });
        return true;
    } catch (error) {
        console.error('Failed to update adblock lists:', error);
        return false;
    }
}

async function loadAdblockPatternsInternal() { // Renamed to avoid conflict if global.js also has it temporarily
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get([ADBLOCK_CACHE_KEY, ADBLOCK_TIMESTAMP_KEY], resolve);
        });

        const cachedPatterns = result[ADBLOCK_CACHE_KEY];
        const lastUpdated = result[ADBLOCK_TIMESTAMP_KEY];

        if (cachedPatterns && Array.isArray(cachedPatterns) && lastUpdated && (Date.now() - lastUpdated < STALE_THRESHOLD_MS)) {
            console.log('Loading adblock patterns from fresh cache.');
            activeAdblockPatterns = cachedPatterns;
        } else {
            if (!cachedPatterns || !Array.isArray(cachedPatterns)) {
                console.log('No valid adblock patterns in cache. Fetching new lists.');
            } else {
                console.log('Adblock patterns cache is stale. Fetching new lists.');
            }
            await updateAdblockLists();
        }
    } catch (error) {
        console.error('Error loading adblock patterns:', error);
        activeAdblockPatterns = [];
        console.log('Attempting to fetch lists as a fallback during load error...');
        await updateAdblockLists(); 
    }
    console.log(`Adblock patterns loaded by adblocker.js. Total patterns: ${activeAdblockPatterns.length}`);
}

// Updated to be async and check storage
self.AdBlockerModuleShouldBlock = function(details) { // Keep original name for now, assign to self.AdBlockerModule.shouldBlock later
    return new Promise((resolve) => {
        chrome.storage.local.get({ adblocking_enabled: true }, function(items) {
            if (!items.adblocking_enabled) {
                resolve(undefined); // Adblocking is disabled
                return;
            }

            if (!activeAdblockPatterns || activeAdblockPatterns.length === 0) {
                resolve(undefined); // No patterns loaded
                return;
            }

            for (const pattern of activeAdblockPatterns) {
                try {
                    if (pattern.type === 'domain') {
                const requestHostname = new URL(details.url).hostname;
                if (requestHostname === pattern.value || requestHostname.endsWith(`.${pattern.value}`)) {
                    return { cancel: true };
                }
            } else if (pattern.type === 'domain_path') {
                const simplifiedUrl = details.url.replace(/^https?:\/\//, '');
                if (simplifiedUrl.startsWith(pattern.value)) {
                    return { cancel: true };
                }
            } else if (pattern.type === 'url_part') {
                if (details.url.includes(pattern.value)) {
                    return { cancel: true };
                }
            } else if (pattern.type === 'wildcard') {
                let regexPattern = pattern.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                regexPattern = regexPattern.replace(/\*/g, '.*?');
                
                if (regexPattern.startsWith('/') && regexPattern.endsWith('/')) {
                    try {
                        const regex = new RegExp(regexPattern.slice(1, -1));
                        if (regex.test(details.url)) {
                            return { cancel: true };
                        }
                    } catch (e) {
                        if (details.url.includes(pattern.value.replace(/\*/g, ''))) {
                             return {cancel: true};
                        }
                    }
                } else {
                    const regex = new RegExp(regexPattern);
                    if (regex.test(details.url)) {
                        return { cancel: true };
                    }
                }
            }
        } catch (e) {
            // console.error("Error matching pattern:", pattern, "for URL:", details.url, e);
                }
            }
            resolve(undefined); // No ad pattern matched
        });
    });
};

function initAdblocker() {
    console.log("Initializing Adblocker module...");
    loadAdblockPatternsInternal(); // Call the renamed internal function
}

// Make functions available globally for global.js (since these are not modules)
// If these were true ES modules, we'd use export. For background scripts, they share a global scope.
// Attaching to `self` which is the global scope for workers/background scripts.
self.AdBlockerModule = {
  init: initAdblocker,
  shouldBlock: self.AdBlockerModuleShouldBlock // Assign the new async function
};

// Initialize the adblocker when the script is loaded.
// This ensures patterns start loading as soon as possible.
AdBlockerModule.init();
