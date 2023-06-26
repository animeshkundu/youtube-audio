const tabIds = new Set();

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

    if (details.url.indexOf('mime=audio') !== -1 && !details.url.includes('live=1')) {
        var parametersToBeRemoved = ['range', 'rn', 'rbuf', 'ump'];
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
        {urls: ["<all_urls>"]},
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
