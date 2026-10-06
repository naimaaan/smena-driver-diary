import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT ?? environment.PORT ?? '3000';
  return {
    plugins: [react(), tailwindcss()],
    build: { outDir: 'dist/client' },
    server: { port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  };
});
