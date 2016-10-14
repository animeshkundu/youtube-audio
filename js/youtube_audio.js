function makeSetAudioURL(videoElement, url) {
    function setAudioURL() {
        if (videoElement.src  != url) {
            videoElement.pause();
            videoElement.src = url;
            videoElement.currentTime = 0;
            videoElement.play();
        }
    }
    setAudioURL();
    return setAudioURL;
}

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        var url = request.url;
        var videoElements = document.getElementsByTagName('video');
        var videoElement = videoElements[0];
        videoElement.onloadeddata = makeSetAudioURL(videoElement, url);
        if (document.getElementsByClassName('audio_only_div').length == 0) {
            var extensionAlert = document.createElement('div');
            extensionAlert.className = 'audio_only_div';

            var alertText = document.createElement('p');
            alertText.className = 'alert_text';
            alertText.innerHTML = 'Youtube Audio Extension is running. It disables the video stream and uses only the audio stream' +
                ' which saves battery life and bandwidth / data when you just want to listen to just songs. If you want to watch' +
                ' video also, click on the extension icon and refresh your page.';

            extensionAlert.appendChild(alertText);
            var parent = videoElement.parentNode.parentNode;
            parent.appendChild(extensionAlert);
        }
    }
);
