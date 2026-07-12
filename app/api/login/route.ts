import { NextRequest, NextResponse } from "next/server";
import {
  checkAccessKey,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

// POST /api/login — troca (nome + senha compartilhada) por um cookie de
// sessao assinado. A validacao "de verdade" acontece aqui no backend.
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
  if (!checkAccessKey(key)) {
    return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
  }

  const token = createSessionToken(name);
  const response = NextResponse.json({ ok: true, name });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
