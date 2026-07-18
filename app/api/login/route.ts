import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { verifyMod } from "@/lib/accounts";
import { normalizeEmail, normalizeUsername } from "@/lib/users";

// POST /api/login — troca (usuario/email + senha) por um cookie de sessao
// assinado. Valida primeiro contra os usuarios cadastrados no banco; se nao
// achar, cai para o MOD_ACCOUNTS (contas antigas via env). A "verdade" e aqui.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    key?: string;
  } | null;

  const identifier = (body?.name || "").trim();
  const password = body?.key ?? "";

  if (!identifier) {
    return NextResponse.json({ error: "Informe seu usuario ou email" }, { status: 400 });
  }

  // 1) Usuario cadastrado no banco (por usuario OU email).
  let dbUsername: string | null = null;
  try {
    const isEmail = identifier.includes("@");
    const where = isEmail
      ? { email: normalizeEmail(identifier) }
      : { username: normalizeUsername(identifier) };
    const user = await prisma.user.findUnique({ where });
    if (user && verifyPassword(password, user.passwordHash)) {
      dbUsername = user.username;
    } else if (user) {
      // Usuario existe mas senha errada — nao cai para o fallback.
      return NextResponse.json({ error: "Usuario/email ou senha incorretos" }, { status: 401 });
    }
  } catch (err) {
    // Banco indisponivel: segue para o fallback MOD_ACCOUNTS.
    console.warn("[login] consulta ao banco falhou:", err instanceof Error ? err.message : err);
  }

  // 2) Fallback: contas antigas do MOD_ACCOUNTS (por nome).
  const canonical = dbUsername ?? verifyMod(identifier, password);
  if (!canonical) {
    return NextResponse.json({ error: "Usuario/email ou senha incorretos" }, { status: 401 });
  }

  const token = createSessionToken(canonical);
  const response = NextResponse.json({ ok: true, name: canonical });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
