import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://exchange.edgeone.app',
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-sans',
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      display: 'swap',
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      fallbacks: ['ui-monospace', 'monospace'],
      display: 'swap',
    },
  ],
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
});
