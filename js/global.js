const tabIds = new Set();

// AdBlockerModule is initialized within adblocker.js itself, which is loaded first.
// No need for an explicit init call here if adblocker.js handles its own initialization.

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
function processRequest(details) {
    // AdBlockerModule.shouldBlock is now async and returns a Promise
    const adBlockPromise = (self.AdBlockerModule && typeof self.AdBlockerModule.shouldBlock === 'function')
        ? self.AdBlockerModule.shouldBlock(details)
        : Promise.resolve(undefined); // Fallback if module or function is missing

    return adBlockPromise.then(adBlockDecision => {
        if (adBlockDecision && adBlockDecision.cancel) { // If adblocker returns {cancel: true}
            // console.log(`AdBlocker decided to block: ${details.url}`);
            return adBlockDecision;
        }

        // If not blocked by adblocker, proceed with existing audio-only logic
        if (!tabIds.has(details.tabId)) {
            return undefined; // Audio logic is only for tracked tabs
        }

        if (details.url.indexOf('mime=audio') !== -1 && !details.url.includes('live=1')) {
            var parametersToBeRemoved = ['range', 'rn', 'rbuf'];
            var audioURL = removeURLParameters(details.url, parametersToBeRemoved);
            // Important: sendMessage is async but onBeforeRequest expects sync return or Promise for blocking
            // This part does not block, it just sends a message.
            chrome.tabs.sendMessage(details.tabId, {url: audioURL});
        }
        return undefined; // Default action for audio logic path
    }).catch(error => {
        console.error("Error processing request in AdBlockerModule or subsequent logic:", error);
        return undefined; // Fallback, don't block if there's an error
    });
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

// AdBlockerModule is initialized within adblocker.js itself, which is loaded first.
// No need for an explicit init call here if adblocker.js handles its own initialization.

function removeURLParameters(url, parameters) {
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

// Adblock patterns are now loaded by adblocker.js's initAdblocker()
