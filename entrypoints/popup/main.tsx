import { render } from 'preact';

import { initializeSettings, watchSettings } from '../../src/shared/config';
import { Popup } from './App';
import '../ui/tokens.css';
import '../ui/components.css';
import './style.css';

async function start() {
  try {
    await initializeSettings();
    watchSettings();
  } finally {
    const app = document.getElementById('app');
    if (app) render(<Popup />, app);
  }
}

void start();
