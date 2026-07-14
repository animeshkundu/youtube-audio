# Privacy

Privacy here is not a policy page, it is how the thing is built. There is no
account, no server of ours, and no analytics, so most of the usual ways an
extension could learn about you simply do not exist.

## What never happens

<ul class="yta-promise">
<li><strong>No account.</strong> It is built for signed-out use, and that is the only supported mode. It never needs, reads, or attaches your YouTube login.</li>
<li><strong>No analytics, no phone-home.</strong> The add-on declares no data collection. It does not call a server of ours, because there isn't one.</li>
<li><strong>No cookies on its requests.</strong> Every fetch it makes, to get your audio or to save a file, goes out credentialless, without your YouTube cookies attached.</li>
</ul>

## The only things that leave your browser

Being specific matters more than a promise, so here is the whole list.

<ul class="yta-promise">
<li><strong>The audio request.</strong> To play sound instead of video, it asks YouTube's own player API for a direct audio stream, without your cookies. This is the core mechanism.</li>
<li><strong>A four-character hash, only if you use skipping.</strong> Segment lookups send just the first four characters of a hash of the video id, a prefix shared by thousands of videos, with no cookies and no referrer. The exact match happens on your machine.</li>
<li><strong>The media itself, from Google's servers.</strong> The audio has to come from somewhere; it streams from <code>googlevideo.com</code>, again without your cookies.</li>
</ul>

That is it. No watch history of yours is uploaded, because it never leaves your
device in the first place.

## The diagnostics are private too

If you report a problem, the built-in reporter builds a log you can read in full
before sending. By design it records only plain facts: which features are on,
bounded counts, a coarse environment. It never records what you watched, what
you searched for, or anything you typed. A captured error message is scrubbed
and length-limited before it is ever shown to you.

!!! note "Fail open is a privacy feature too"
    Because every feature reverts to normal YouTube the moment it is unsure, the
    add-on never has to take risky, sticky actions to keep working. Less
    cleverness in the hot path means fewer places for anything to go wrong.

For exactly how the credentialless fetch and the four-character hash work, see
[How it works](../architecture/README.md) and the
[research notes](../research/05-ghost-mode-anti-tracking.md).

Next: [questions and troubleshooting :material-arrow-right:](faq.md)
