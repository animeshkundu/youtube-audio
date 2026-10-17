/**
 * Optional-permission constants (SPEC-013, ADR-0010 revision): one source of truth shared by the
 * WXT manifest config, the background's double gates, and the options-page grant gestures. This
 * module is intentionally pure (no browser APIs at module scope) so the build config can import it
 * and unit tests can assert against the exact strings.
 */

/** Host pattern for the optional SponsorBlock proxy origin (co-extensive with its opt-in). */
export const SPONSORBLOCK_ORIGIN = 'https://sponsor.ajay.app/*';

/** Optional `downloads` API permission; absent from Firefox for Android, so it stays ungranted. */
export const DOWNLOADS_PERMISSION = 'downloads';
