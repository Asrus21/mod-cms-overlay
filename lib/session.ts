import crypto from "crypto";

// Sessao minima assinada por HMAC. Nao usamos OAuth: cada mod entra com o
// proprio nome + senha (ver lib/accounts.ts). O nome canonico vai dentro de um
// cookie assinado para nao poder ser adulterado no cliente, alimenta o log de
// auditoria e define a "mesa" (canal/estado) daquele mod.

export { SESSION_COOKIE, SESSION_MAX_AGE } from "./session-cookie";

export type ModSession = { name: string; iat: number };

function getSecret(): string {
  return process.env.SESSION_SECRET || "";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function createSessionToken(name: string): string {
  const payload = Buffer.from(
    JSON.stringify({ name, iat: Date.now() } satisfies ModSession)
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token?: string | null): ModSession | null {
  if (!token || !getSecret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ) as ModSession;
    if (!data.name) return null;
    return data;
  } catch {
    return null;
  }
}
