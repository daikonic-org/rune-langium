// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

export const loopback = '127.0.0.1';
export const pagesPort = 8788;
export const workers = [
  { name: 'curated-mirror', port: 8789, paths: ['/curated', '/releases'], allowOrigin: true },
  { name: 'lsp', port: 8790, paths: ['/rune-studio/api/lsp'], allowOrigin: true, webSocket: true },
  { name: 'telemetry', port: 8791, paths: ['/rune-studio/api/telemetry'], allowOrigin: true },
  { name: 'github-auth', port: 8792, paths: ['/rune-studio/api/github-auth'], allowOrigin: true },
  { name: 'cdm-example-data', port: 8793, paths: [] }
];

export function localOrigin(port) {
  return `http://${loopback}:${port}`;
}
