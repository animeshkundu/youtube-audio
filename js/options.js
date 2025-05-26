// Function to save options
function save_options() {
  var disableVideoText = document.getElementById('disable-video-text').checked;
  var enableAdblocking = document.getElementById('enableAdblocking').checked;
  var enableSponsorSkipping = document.getElementById('enableSponsorSkipping').checked;

  chrome.storage.local.set({
    disable_video_text: disableVideoText,
    adblocking_enabled: enableAdblocking,
    sponsor_skipping_enabled: enableSponsorSkipping
  }, function() {
    // Optional: Update status to let user know options were saved.
    // var status = document.getElementById('status');
    // status.textContent = 'Options saved.';
    // setTimeout(function() {
    //   status.textContent = '';
    // }, 750);
    console.log("Options saved.");
  });
}

// Function to restore options
function restore_options() {
  chrome.storage.local.get({
    // Default values
    disable_video_text: false,
    adblocking_enabled: true, 
    sponsor_skipping_enabled: true 
  }, function(items) {
    document.getElementById('disable-video-text').checked = items.disable_video_text;
    document.getElementById('enableAdblocking').checked = items.adblocking_enabled;
    document.getElementById('enableSponsorSkipping').checked = items.sponsor_skipping_enabled;
  });
}

// Event listeners for options changes
document.addEventListener('DOMContentLoaded', restore_options);

// Add change listeners to each checkbox
var disableVideoTextCheckbox = document.getElementById("disable-video-text");
if (disableVideoTextCheckbox) {
  disableVideoTextCheckbox.addEventListener("change", save_options);
}

var enableAdblockingCheckbox = document.getElementById("enableAdblocking");
if (enableAdblockingCheckbox) {
  enableAdblockingCheckbox.addEventListener("change", save_options);
}

var enableSponsorSkippingCheckbox = document.getElementById("enableSponsorSkipping");
if (enableSponsorSkippingCheckbox) {
  enableSponsorSkippingCheckbox.addEventListener("change", save_options);
}
