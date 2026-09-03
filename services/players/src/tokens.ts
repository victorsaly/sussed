/**
 * Tokens. HMAC-signed, short-lived, carried in an Authorization header.
 *
 * Not cookies — nine games live on nine different domains and third-party
 * cookies no longer work anywhere. A bearer token in each game's own storage
 * is the pattern that survives.
 */

const encoder = new TextEncoder();

export interface Claims {
  sub: string; // user id
  dev: string; // device id
  tier: 'anonymous' | 'portable';
  exp: number; // epoch ms
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function sign(claims: Claims, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return `${body}.${b64url(mac)}`;
}

export async function verify(token: string, secret: string): Promise<Claims | null> {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const ok = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    unb64url(mac),
    encoder.encode(body),
  );
  if (!ok) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64url(body))) as Claims;
    if (claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
