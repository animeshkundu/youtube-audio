import { render } from 'preact';

import { initializeSettings, watchSettings } from '../../src/shared/config';
import { hasSeenOnboarding, Options } from './App';
import '../ui/tokens.css';
import '../ui/components.css';
import './style.css';

async function start() {
  const [, seenOnboarding] = await Promise.all([
    initializeSettings(),
    hasSeenOnboarding().catch(() => false),
  ]);
  watchSettings();
  const app = document.getElementById('app');
  if (app) render(<Options showOnboardingInitially={!seenOnboarding} />, app);
}

void start();
