import crypto from "crypto";

// Token de redefinicao de senha. O valor em CLARO vai no link do email; no
// banco guardamos apenas o HASH (sha256), de modo que vazar o banco nao expoe
// tokens usaveis. Uso unico e validade curta sao aplicados na rota.

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
