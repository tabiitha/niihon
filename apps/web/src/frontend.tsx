// Entry point of the Web interface, loaded by index.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element.');
}
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Keeps one React root across hot reloads in development (https://bun.com/docs/bundler/hot-reloading).
if (import.meta.hot) {
  (import.meta.hot.data.root ??= createRoot(container)).render(app);
} else {
  createRoot(container).render(app);
}
