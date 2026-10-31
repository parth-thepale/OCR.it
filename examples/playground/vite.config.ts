import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['local-agent-ocr'],
  },
  resolve: {
    alias: {
      'local-agent-ocr/react': path.resolve(__dirname, '../../src/react.ts'),
      'local-agent-ocr/tools': path.resolve(__dirname, '../../src/tools.ts'),
      'local-agent-ocr': path.resolve(__dirname, '../../src/index.ts'),
    },
  },
});
