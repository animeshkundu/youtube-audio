import { defineBackground } from 'wxt/utils/define-background';

import { initializeSettings, watchSettings } from '../src/shared/config';
import { getExtensionPlatform } from '../src/shared/platform';
import { loadRescueConfig } from '../src/shared/rescue';
import { getSponsorSegments } from '../src/shared/sponsorblock';

export default defineBackground({
  persistent: { firefox: true },
  async main() {
    try {
      getExtensionPlatform();
      void loadRescueConfig;
      void getSponsorSegments;
      await initializeSettings();
      watchSettings();
    } catch (error) {
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
