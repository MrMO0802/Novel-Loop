import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/project-library.css';
import './styles/foundation.css';
import './styles/planning.css';
import './styles/chapter.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Novel Loop renderer root is missing.');
}

createRoot(root).render(<App />);
