import { createRoot } from 'react-dom/client';
import { App, createAppRouter, createQueryClient, reloadOnStaleChunks } from './app';
import './styles.css';

/** The self-hosted app: the library with its defaults (DECISIONS #58). */
const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

reloadOnStaleChunks();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(<App router={router} queryClient={createQueryClient()} />);
