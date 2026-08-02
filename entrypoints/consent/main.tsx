import { render } from 'preact';

import { ConsentPage } from './App';
import '../ui/tokens.css';
import '../ui/components.css';
import './style.css';

const app = document.getElementById('app');
if (app) render(<ConsentPage />, app);
