import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // Vite and @vitejs/plugin-react decide "is this a production build?" from NODE_ENV and
  // keep whatever value is already set, so building from a shell that exports
  // NODE_ENV=development silently ships React's DEVELOPMENT build: its dev-only warnings
  // show up in every player's F8 console and the bundle is far larger. Setting it here
  // runs before Vite resolves the config, so a build is always a real production build.
  //
  // Do NOT try to fix this with `define: { 'process.env.NODE_ENV': '"production"' }`:
  // that swaps the runtime package while the JSX transform stays in dev mode, and the
  // NUI dies at load with "jsxDEV is not a function".
  if (command === 'build') {
    process.env.NODE_ENV = 'production';
  }

  return {
    plugins: [react()],
    base: './',
    build: {
      outDir: 'build',
    },
  };
});
