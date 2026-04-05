import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (
              id.includes('react-force-graph-2d') ||
              id.includes('force-graph') ||
              id.includes(`${path.sep}three${path.sep}`)
            ) {
              return 'vendor-force-graph';
            }

            if (
              id.includes('recharts') ||
              id.includes(`${path.sep}d3${path.sep}`)
            ) {
              return 'vendor-charts';
            }

            if (
              id.includes('react-markdown') ||
              id.includes('remark-') ||
              id.includes('rehype-') ||
              id.includes('micromark') ||
              id.includes('mdast') ||
              id.includes('hast') ||
              id.includes('unist')
            ) {
              return 'vendor-markdown';
            }

            if (
              id.includes('lucide-react') ||
              id.includes(`${path.sep}motion${path.sep}`) ||
              id.includes('framer-motion')
            ) {
              return 'vendor-ui';
            }

            if (id.includes('@google/genai')) {
              return 'vendor-ai';
            }

            if (
              id.includes(`${path.sep}react${path.sep}`) ||
              id.includes(`${path.sep}react-dom${path.sep}`) ||
              id.includes(`${path.sep}scheduler${path.sep}`)
            ) {
              return 'vendor-react';
            }
          },
        },
      },
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
