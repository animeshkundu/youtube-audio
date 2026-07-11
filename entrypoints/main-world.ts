import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { createAudioGraph } from '../src/shared/audiograph';
import { buildAndroidVrPlayerRequest } from '../src/shared/innertube';
import { createPlayerEventBus } from '../src/shared/player';

export default defineUnlistedScript(() => {
  // Import the real modules now so WXT keeps this as the future page-world boundary.
  void buildAndroidVrPlayerRequest;
  void createAudioGraph;
  createPlayerEventBus();
  // TODO(M1): Install validated player hooks and the credentialless request flow.
});
