# AMO review reply drafts (1.0.x)

Ready-to-paste replies to the five reviews left on the **1.0.x** line (plan item H2). These need the
signed-in AMO account: post them from the Developer Hub (**Ratings & reviews**) or from the listing
page while signed in. Replies are public and permanent, so they stay factual: what changed, what to
do if it still fails, no dates promised. Post once 1.1.0 is submitted (or approved) so the reply is
truthful about the update existing.

The five reviews, as published on the AMO listing (fetched 2026-10-16):

| Review ID | Date       | ★   | Body                                                                                       |
| --------- | ---------- | --- | ------------------------------------------------------------------------------------------ |
| 2734983   | 2026-08-07 | 1   | "Doesn't work"                                                                             |
| 2736000   | 2026-08-11 | 2   | "8.11.26 asking for too many Required permissions"                                         |
| 2737379   | 2026-08-16 | 1   | "doesn't work"                                                                             |
| 2737712   | 2026-08-17 | 1   | "Currently seems to be broken and interfering with youtube ad blocking with ublock origin" |
| 2761981   | 2026-10-07 | 1   | "does not work"                                                                            |

## 2734983 (1★, "Doesn't work")

Thanks for the report, and sorry. 1.0.x went stale against YouTube-side changes: the client it used
to fetch the audio stream started failing, and the breakage became total after the August 2026
player change, so audio-only fell back to video (or nowhere). The update replaces the fixed client
with a rotating client table and adds a live canary that fails loudly when YouTube changes again.
If anything still misbehaves after the update, Settings > Help & feedback has a "Copy diagnostics"
button whose report shows exactly where it stops.

## 2736000 (2★, "asking for too many Required permissions")

Fair, and fixed in the update: the optional features became optional permissions. The SponsorBlock
API origin and the download capability are now requested only at the moment you turn those features
on, from the same action that enables them, so the always-required set is the YouTube-family
origins plus the direct media origin (`googlevideo.com`). Settings > Data & consent lists what
each permission is used for.

## 2737379 (1★, "doesn't work")

Same story as the other 1.0.x reports, and sorry about it: the old media fetch stopped working when
YouTube changed the player in August 2026. The update rebuilds media acquisition around a rotating
client table, keeps the failure path "hand the page back to normal YouTube playback", and ships a
canary that catches this class of breakage before a release. If it still fails after the update,
please attach the diagnostics report from Settings > Help & feedback ("Copy diagnostics").

## 2737712 (1★, "interfering with youtube ad blocking with ublock origin")

Thanks, and sorry for the collision. 1.0.x rewrote player responses in ways that could fight another
extension's patches. The update changes the policy to coexistence: a patch another extension
already installed is adopted and chained with ours (only our own response gets pruned), and when a
page cannot be safely pruned we leave it alone instead of fighting for it. If you still see
interference after the update, a diagnostics report (Settings > Help & feedback) captures what
happened.

## 2761981 (1★, "does not work")

Thanks for confirming it was still broken in October. That matches what we found: from the August
2026 player change, the media URLs the 1.0.x fetch asked for came back as HTTP 403 for everyone, so
nothing played. The update replaces that fetch entirely (rotating clients, one bounded retry per
client, honest failure into native playback) and adds a canary. If anything still fails after the
update, the diagnostics report (Settings > Help & feedback, "Copy diagnostics") has the detail
needed to see where.
