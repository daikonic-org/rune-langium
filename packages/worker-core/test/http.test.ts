// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { corsJsonResponse, jsonResponse } from '../src/http.js';

describe('Worker JSON responses', () => {
  it('preserves error status, JSON encoding and caller headers', async () => {
    const response = jsonResponse(429, { error: 'wait', retryAfter: 5 }, { 'Retry-After': '5' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toEqual({ error: 'wait', retryAfter: 5 });
  });

  it('allows callers to override the default content type', () => {
    const response = jsonResponse(200, {}, { 'Content-Type': 'application/problem+json' });
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('retains the checked origin and Vary header on CORS responses', async () => {
    const response = corsJsonResponse(401, { error: 'denied' }, 'https://studio.example');
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(await response.json()).toEqual({ error: 'denied' });
  });
});
