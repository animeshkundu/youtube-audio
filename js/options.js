// Fetch references to the options' corresponding HTML elements
var disableVideoTextCheckbox = document.getElementById("disable-video-text");

// Initialize option elements (register listeners & set initial states)
if (disableVideoTextCheckbox) {
  // Register listeners
  disableVideoTextCheckbox.addEventListener("change", optionChanged);

  // Set states
  chrome.storage.local.get('disable_video_text', function(values) {
    disableVideoTextCheckbox.checked = (values.disable_video_text ? true : false);
  });
}

var disableYoutubeThumbnailCheckbox = document.getElementById('disable-youtube-thumbnail');

if (disableYoutubeThumbnailCheckbox) {
  disableYoutubeThumbnailCheckbox.addEventListener('change', thumbnailOptionChanged);
  
  chrome.storage.local.get('disable_youtube_thumbnail', function(values) {
    disableYoutubeThumbnailCheckbox.checked = (values.disable_youtube_thumbnail ? true : false);
  });
}
  
// Save options as they're modified
function optionChanged() {
  chrome.storage.local.set({
    "disable_video_text": disableVideoTextCheckbox.checked
  });
}

function thumbnailOptionChanged() {
  chrome.storage.local.set({
  	"disable_youtube_thumbnail": disableYoutubeThumbnailCheckbox.checked
  });
}
