// Lint: catches a missing import (no-undef) or a stale one (no-unused-vars) before the browser does.
const browser = Object.fromEntries([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'history', 'console',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'crypto', 'btoa', 'atob', 'getSelection',
  'TextEncoder', 'TextDecoder', 'Uint8Array', 'Uint32Array', 'URLSearchParams', 'matchMedia', 'AudioContext',
  'firebase',
].map(n => [n, 'readonly']));
const node = Object.fromEntries(['process', 'URL'].map(n => [n, 'readonly']));

export default [
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browser, ...node } },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'error' },
  },
];
