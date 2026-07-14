# Install

YouTube Audio runs on **Firefox 128 and up**, on both desktop and Android. It is
the same add-on on both, under one permanent identity, so it updates itself the
same way in both places.

<figure class="frame-popup" markdown>
![The first-run screen: audio-only, background play, and ad blocking are already on, with nothing to set up.](../assets/screenshots/onboarding.png)
</figure>

There is nothing to configure to get started. The essentials are on the moment
you install it, and the first-run screen just points you at YouTube.

## Firefox desktop

The production build is distributed through Mozilla Add-ons (AMO) on the
**listed** channel, which is also what keeps it up to date for you
automatically. Install it, and you are done.

If you would rather run it straight from the source, or you want the latest
unreleased work:

1. Clone the repository and build the extension:

    ```bash
    npm install
    npm run build
    ```

2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Choose **Load Temporary Add-on** and pick any file inside
    `.output/firefox-mv2/` (for example `manifest.json`).

A temporary add-on lasts until you close Firefox, which is perfect for trying
things out. For a permanent install, use the AMO build or the signed beta.

## Firefox for Android

Android is a first-class target, not a cut-down mobile mode. The manifest ships
`gecko_android`, and the interface folds into a touch-friendly layout with the
quick controls right at the top.

Production installs and updates through the same AMO listing as desktop, under
the same add-on identity. To try a **beta** build by hand, open Firefox's
settings, choose **Install extension from file**, and pick the signed `.xpi`.
Beta updates are manual.

## The beta channel

Beta builds share the same add-on identity as production, signed by Mozilla on
the **unlisted** channel at a distinct pre-release version. They are installed
by hand for testing on desktop and Android. See
[ADR-0006](../adrs/0006-firefox-amo-distribution-and-beta-channel.md) for how
the listed and beta channels fit together, and
[the release process](../ci-cd.md) for how builds are cut and signed.

## What it asks for

The add-on keeps its reach deliberately narrow:

<ul class="yta-promise">
<li><strong>YouTube and YouTube Music pages.</strong> Its content scripts run only on YouTube's four watch surfaces, never on the wider web.</li>
<li><strong>Google's video servers.</strong> It needs to fetch the audio stream itself, so it can talk to <code>googlevideo.com</code>.</li>
<li><strong>SponsorBlock, only if you use skipping.</strong> Segment lookups go to <code>sponsor.ajay.app</code>, and only a short hash ever leaves your machine.</li>
<li><strong>Saving files, only if you use download.</strong> The download feature uses Firefox's downloads permission to write the <code>.m4a</code>.</li>
</ul>

Next: [the audio-only experience :material-arrow-right:](audio.md)
