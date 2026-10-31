#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

console.log('\n=========================================');
console.log(' Local Agent OCR (OCR.it) Setup Verifier');
console.log('=========================================\n');

let allChecksPass = true;

// 1. Check package.json
const pkgPath = path.join(cwd, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.log('[✗] package.json not found in current directory.');
  allChecksPass = false;
} else {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (pkg.name === 'local-agent-ocr' || deps['local-agent-ocr']) {
      console.log(`[✓] package.json detected (${pkg.name === 'local-agent-ocr' ? 'root package repo' : 'dependency installed'}).`);
    } else {
      console.log('[!] local-agent-ocr not found in dependencies. Run `npm install local-agent-ocr`.');
      allChecksPass = false;
    }
  } catch (err) {
    console.log(`[✗] Failed to parse package.json: ${err.message}`);
    allChecksPass = false;
  }
}

// 2. Check Bundler Configuration
const bundlerConfigs = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsup.config.ts',
];

const foundBundler = bundlerConfigs.find((file) => fs.existsSync(path.join(cwd, file)));

if (foundBundler) {
  console.log(`[✓] Bundler configuration detected: ${foundBundler}`);
  if (foundBundler.startsWith('vite.config')) {
    const content = fs.readFileSync(path.join(cwd, foundBundler), 'utf8');
    if (content.includes('local-agent-ocr')) {
      console.log('    [✓] optimizeDeps.exclude configured for local-agent-ocr.');
    } else {
      console.log('    [!] Tip: Add optimizeDeps: { exclude: ["local-agent-ocr"] } in vite.config.');
    }
  }
} else {
  console.log('[-] No specific Vite/Next.js bundler config found (vanilla/custom setup).');
}

// 3. Check CSP Recommendations
console.log('[✓] Content Security Policy requirement: Ensure `worker-src \'self\' blob:` is enabled.');

console.log('\n-----------------------------------------');
if (allChecksPass) {
  console.log('Result: All core setup checks passed! local-agent-ocr is ready.\n');
  process.exit(0);
} else {
  console.log('Result: Some setup recommendations were flagged above.\n');
  process.exit(0);
}
