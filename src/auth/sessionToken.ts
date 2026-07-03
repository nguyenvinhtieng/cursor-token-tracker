/**
 * Cursor stores a bare JWT in state.vscdb, but dashboard APIs expect
 * WorkosCursorSessionToken = "<sub>::<jwt>".
 */

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.trim().split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = parts[1];
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractJwtFromSessionToken(raw: string): string {
  const trimmed = raw.trim();
  const decoded = decodeURIComponent(trimmed);
  if (decoded.includes('::')) {
    const parts = decoded.split('::');
    return parts.slice(1).join('::');
  }
  return trimmed;
}

export function buildSessionCookie(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const decoded = decodeURIComponent(trimmed);

  // Already in sub::jwt form
  if (decoded.includes('::')) {
    const [sub, ...rest] = decoded.split('::');
    const jwt = rest.join('::');
    if (sub && jwt) {
      return `${sub}::${jwt}`;
    }
  }

  // Bare JWT from state.vscdb / keychain
  const payload = decodeJwtPayload(trimmed);
  const sub = payload?.sub;
  if (typeof sub === 'string' && sub.length > 0) {
    return `${sub}::${trimmed}`;
  }

  return undefined;
}

export function describeTokenSource(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('::') || decodeURIComponent(trimmed).includes('::')) {
    return 'preformed sub::jwt';
  }
  const payload = decodeJwtPayload(trimmed);
  if (payload?.sub) {
    return `jwt (sub=${String(payload.sub).slice(0, 12)}…)`;
  }
  return 'unknown format';
}
