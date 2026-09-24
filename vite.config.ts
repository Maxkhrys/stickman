import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// development/preview-only build identifier ("drawn-v3 <sha>"); empty on production deploys
function buildTag() {
  if (process.env.VERCEL_ENV === 'production') return '';
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!sha) try { sha = execSync('git rev-parse HEAD').toString().trim(); } catch { sha = 'local'; }
  return `drawn-v3 ${sha.slice(0, 7)}`;
}

export default defineConfig({
  base: './',
  define: { __BUILD_TAG__: JSON.stringify(buildTag()) },
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
