import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const devHmrPort = Number(process.env.DOCSTUBE_LOCAL_UI_HMR_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    hmr:
      process.env.DOCSTUBE_LOCAL_UI_DEV === '1'
        ? {
            clientPort: devHmrPort,
            host: '127.0.0.1',
            port: devHmrPort
          }
        : undefined
  }
});
