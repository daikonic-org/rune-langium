// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** JSON response with caller-owned status and header policy. */
export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

/** JSON response for routes that already checked their allowed origin. */
export function corsJsonResponse(status: number, body: unknown, origin: string): Response {
  return jsonResponse(status, body, {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin'
  });
}
