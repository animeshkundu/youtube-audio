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
  
// Save options as they're modified
function optionChanged() {
  chrome.storage.local.set({
    "disable_video_text": disableVideoTextCheckbox.checked
  });
}
