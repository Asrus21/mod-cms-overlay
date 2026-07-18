import crypto from "crypto";

// Sessao minima assinada por HMAC. O login e via Twitch (OAuth): guardamos no
// cookie assinado a identidade da Twitch (login/nome/foto) + se e o usuario
// master. `name` = login da Twitch (minusculo, unico) — e a identidade "dono"
// da mesa (canal/estado por mod) e alimenta o log de auditoria.

export { SESSION_COOKIE, SESSION_MAX_AGE } from "./session-cookie";

export type ModSession = {
  name: string; // login da Twitch (identidade "dono")
  display: string; // nome de exibicao da Twitch (para o header)
  photo: string; // URL da foto de perfil da Twitch
  master: boolean; // usuario master (asrus12): busca qualquer streamer
  iat: number;
};

export type SessionInput = Omit<ModSession, "iat">;

function getSecret(): string {
  return process.env.SESSION_SECRET || "";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function createSessionToken(input: SessionInput): string {
  const payload = Buffer.from(
    JSON.stringify({ ...input, iat: Date.now() } satisfies ModSession)
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
    return {
      name: data.name,
      display: data.display || data.name,
      photo: data.photo || "",
      master: Boolean(data.master),
      iat: data.iat || 0,
    };
  } catch {
    return null;
  }
}
