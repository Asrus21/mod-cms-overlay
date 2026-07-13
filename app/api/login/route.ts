import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { hasModAccounts, verifyMod } from "@/lib/accounts";

// POST /api/login — troca (nome + senha do proprio mod) por um cookie de
// sessao assinado. Cada mod tem sua conta e sua mesa isolada. A validacao
// "de verdade" acontece aqui no backend.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    key?: string;
  } | null;

  const name = body?.name?.trim();
  const key = body?.key ?? "";

  if (!name) {
    return NextResponse.json({ error: "Informe seu nome" }, { status: 400 });
  }
  if (!hasModAccounts()) {
    return NextResponse.json(
      { error: "Contas de mod nao configuradas no servidor (defina MOD_ACCOUNTS na Vercel)." },
      { status: 503 }
    );
  }
  const canonical = verifyMod(name, key);
  if (!canonical) {
    return NextResponse.json({ error: "Nome ou senha incorretos" }, { status: 401 });
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
