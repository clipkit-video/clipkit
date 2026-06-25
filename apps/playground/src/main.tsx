import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './App.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
// Not wrapped in StrictMode: the renderer's WebGPU context is canvas-scoped,
// and StrictMode's intentional double-mount creates two renderers on the same
// canvas, which leaves the second one with a context the first one configured.
createRoot(root).render(<App />);
