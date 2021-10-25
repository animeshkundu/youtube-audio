chrome.runtime.sendMessage('enable-youtube-audio');

var makeSetAudioURL = function (videoElement, url) {
    if (videoElement.src != url) {
        var paused = videoElement.paused;
        videoElement.src = url;
        if (paused === false) {
            videoElement.play();
        }
    }
};

// Note: I just put the thumbnail together with the audio only text.

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
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
        alertText.innerHTML =
            'Youtube Audio Extension is running. It disables the video stream and uses only the audio stream' +
            ' which saves battery life and bandwidth / data when you just want to listen to just songs. If you want to watch' +
            ' video also, click on the extension icon and refresh your page.';

        extensionAlert.appendChild(alertText);
        let parent = videoElement.parentNode.parentNode;

        const ytid = document.location.href.split('=')[1];
        function createThumbnailURL(image) {
            return 'https://i.ytimg.com/vi/' + ytid + '/' + image + '.jpg';
        }

        // Test thumbnail availability
        function testThumbnail(image) {
            return new Promise(function (resolve, reject) {
                const req = new XMLHttpRequest();
                req.onreadystatechange = function () {
                    if (this.readyState == 4 && this.status == 200) {
                        resolve(true);
                    } else if (this.readyState == 4 && this.status != 200) {
                        resolve(false);
                    }
                };
                req.open('GET', createThumbnailURL(image));
                req.send();
            });
        }

        // This really needs refactoring
        (function () {
            // thumbnail quality in descending order
            const images = [
                'maxresdefault',
                'hq720',
                'sddefault',
                'hqdefault',
                'mqdefault',
                'default',
            ];
            (function () {
                // Checks for each available thumbnail sequentially, stop when found.
                return new Promise(function (resolve, reject) {
                    let func = function () {
                        resolve('');
                    };
                    // Reverse index so last item in array is checked last
                    for (let i = images.length - 1; i >= 0; i--) {
                        func = function () {
                            testThumbnail(images[i]).then(function (result) {
                                if (result === true) {
                                    resolve(createThumbnailURL(images[i]));
                                } else {
                                    func();
                                }
                            });
                        };
                    }
                    func();
                });
            })().then(function (availableImage) {
                // Put thumbnail in video
                const youtubeThumbnail = document.createElement('div');
                youtubeThumbnail.className = 'youtube_thumbnail_div';

                const thumbnailImage = document.createElement('img');
                thumbnailImage.className = 'youtube_thumbnail';
                thumbnailImage.src = availableImage;

                // An observer to detect url change on YouTube
                const observer = new MutationObserver(function (mutations) {
                    mutations.forEach(function (mutationRecord) {
                        if (mutationRecord.target.style.display == 'none') {
                            thumbnailImage.src = availableImage;
                        }
                    });
                });

                youtubeThumbnail.appendChild(thumbnailImage);

                chrome.storage.local.get(
                    'disable_youtube_thumbnail',
                    function (values) {
                        var disableYoutubeThumbnail =
                            values.disable_youtube_thumbnail ? true : false;
                        if (
                            !disableYoutubeThumbnail &&
                            parent.getElementsByClassName(
                                'youtube_thumbnail_div'
                            ).length == 0
                        ) {
                            var target = document.getElementsByClassName(
                                'ytp-cued-thumbnail-overlay'
                            )[0];
                            observer.observe(target, {
                                attributes: true,
                                attributeFilter: ['style'],
                            });
                            parent.insertBefore(
                                youtubeThumbnail,
                                parent.children[2]
                            );
                        }
                    }
                );
            });
        })();

        // Append alert only if options specify to do so
        chrome.storage.local.get('disable_video_text', function (values) {
            var disableVideoText = values.disable_video_text ? true : false;
            if (
                !disableVideoText &&
                parent.getElementsByClassName('audio_only_div').length == 0
            )
                parent.insertBefore(extensionAlert, parent.children[2]);
        });
    } else if (url == '') {
        for (div in audioOnlyDivs) {
            div.parentNode.removeChild(div);
        }
    }
});
