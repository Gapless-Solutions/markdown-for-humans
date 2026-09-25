#!/usr/bin/env node

/**
 * Build Script for Extension Bundle
 *
 * Uses esbuild programmatically so we can selectively remove console.log/debug/info
 * in production builds while keeping console.warn and console.error.
 *
 * Usage:
 *   node scripts/build-extension.js          # Development build (debug)
 *   node scripts/build-extension.js --prod   # Production build (minified, drops console.log/debug/info, no sourcemaps)
 *   node scripts/build-extension.js --watch  # Watch mode (development)
 *   node scripts/build-extension.js --prod --no-sourcemap # Release build (marketplace)
 */

const esbuild = require('esbuild');
const fs = require('fs');
const { consoleStripOptions } = require('./console-strip');

const args = process.argv.slice(2);
const isProduction = args.includes('--prod') || process.env.NODE_ENV === 'production';
const isWatch = args.includes('--watch');
const noSourcemap = args.includes('--no-sourcemap');

// Export (HTML/PDF/Word) pulls in cheerio - and through it undici, iconv-lite
// and parse5 - plus docx: ~1.7 MB of the host bundle, all of it parsed at
// activation, which is on the critical path of the first markdown file opened.
// CJS output cannot code-split, so the export module is built as its own entry
// and the provider's `await import('../features/documentExport')` resolves to
// a stub that requires that sibling file at runtime. It must be a require():
// an external import() is emitted verbatim and would load through Node's ESM
// loader rather than the extension host's CJS loader, which provides `vscode`.
const splitDocumentExport = {
  name: 'split-document-export',
  setup(build) {
    build.onResolve({ filter: /[\\/]features[\\/]documentExport$/ }, args =>
      args.kind === 'entry-point' ? undefined : { path: 'documentExport', namespace: 'lazy-require' }
    );
    build.onLoad({ filter: /.*/, namespace: 'lazy-require' }, () => ({
      contents: "module.exports = require('./documentExport.js');",
      loader: 'js',
    }));
    build.onResolve({ filter: /^\.\/documentExport\.js$/, namespace: 'lazy-require' }, args => ({
      path: args.path,
      external: true,
    }));
  },
};

const buildOptions = {
  entryPoints: {
    extension: 'src/extension.ts',
    documentExport: 'src/features/documentExport.ts',
  },
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  plugins: [splitDocumentExport],
  format: 'cjs',
  platform: 'node',
  sourcemap: !noSourcemap && !isProduction,
  minify: isProduction,
  treeShaking: true,
  // Remove console.log/debug/info calls in production bundles (keep warn/error).
  // See scripts/console-strip.js for why 'pure' alone is insufficient.
  ...consoleStripOptions(isProduction),
};

async function build() {
  if (isWatch) {
    // Watch mode - development build
    const context = await esbuild.context({
      ...buildOptions,
      minify: false, // Never minify in watch mode
      ...consoleStripOptions(false), // Keep all console logs in watch mode
    });

    await context.watch();
    console.log('👀 Watching for changes... (Press Ctrl+C to stop)');
  } else {
    // One-time build
    try {
      await esbuild.build(buildOptions);

      // Ensure release builds don't leave stale sourcemaps in dist/
      if (isProduction || noSourcemap) {
        for (const mapFile of ['dist/extension.js.map', 'dist/documentExport.js.map']) {
          try {
            fs.unlinkSync(mapFile);
          } catch {
            // ignore - file may not exist
          }
        }
      }

      console.log(
        `✅ Extension build complete${isProduction ? ' (production)' : ' (development)'}${
          noSourcemap ? ' (no sourcemap)' : ''
        }`
      );
    } catch (error) {
      console.error('❌ Build failed:', error);
      process.exit(1);
    }
  }
}

build().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
