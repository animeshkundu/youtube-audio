# Youtube Audio Extension

Streamline your YouTube experience by focusing on the audio, saving battery life, and reducing data usage. This extension also includes adblocking and sponsor segment skipping for uninterrupted listening.

## Features

*   **Audio-Only Mode**: Disables video playback on YouTube, allowing you to listen to music or talks without the video stream consuming resources. This is perfect for background listening, saving battery, and reducing bandwidth.
*   **Adblocking**: Automatically blocks many common advertisements on YouTube, providing a smoother listening experience.
*   **Sponsor Segment Skipping**: Integrates with the SponsorBlock API (sponsor.ajay.app) to automatically skip various segments such as sponsors, intros, outros, self-promotion, and interaction reminders. This helps you get straight to the content you care about.

## Installation

Available on Firefox: [Youtube Audio on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/?src=search)

Contributions for publishing on other browsers (like Chrome or Safari) are welcome!

## Development

This project includes a setup for automated testing and continuous integration/continuous deployment (CI/CD) to ensure quality and streamline development.

*   **Testing**: Unit tests have been implemented for core functionalities using the Jest testing framework. These tests help ensure that individual parts of the extension work as expected.
*   **CI/CD with GitHub Actions**:
    *   **Automated Testing**: Every push and pull request to the main branches triggers a GitHub Actions workflow that automatically installs dependencies and runs the full Jest test suite across multiple Node.js versions.
    *   **Automated Packaging**: When a new version tag (e.g., `v1.2.3`) is pushed, the CI workflow also packages the extension files into a ZIP archive (`youtube-audio-extension.zip`) and uploads it as a build artifact. This makes it easy to grab new releases.

## Contributing

Contributions are welcome! If you'd like to help improve the extension or assist with publishing to other browsers, please feel free to open an issue or submit a pull request.

---

_Original motivation: I mostly listen to songs a lot on YouTube while working. The video playing in the background just heats up my laptop, eats up my battery and data / bandwidth. YouTube doesn't provide this functionality natively._
