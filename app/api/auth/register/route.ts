import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/users";

// POST /api/auth/register — cadastro proprio: email + usuario + senha.
// Cria o usuario (senha em hash scrypt) e ja loga (cookie de sessao).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    username?: string;
    password?: string;
    inviteCode?: string;
  } | null;

  // Codigo de convite OPCIONAL: se REGISTER_INVITE_CODE estiver definido no
  // servidor, o cadastro exige esse codigo (fecha o registro so para quem tem).
  // Sem a env, o cadastro fica aberto.
  const requiredInvite = process.env.REGISTER_INVITE_CODE || "";
  if (requiredInvite) {
    const provided = (body?.inviteCode || "").trim();
    const a = Buffer.from(provided);
    const b = Buffer.from(requiredInvite);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return NextResponse.json({ error: "Código de convite inválido" }, { status: 403 });
    }
  }

  const email = normalizeEmail(body?.email || "");
  const username = normalizeUsername(body?.username || "");
  const password = body?.password || "";

  const emailErr = validateEmail(email);
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
  const userErr = validateUsername(username);
  if (userErr) return NextResponse.json({ error: userErr }, { status: 400 });
  const passErr = validatePassword(password);
  if (passErr) return NextResponse.json({ error: passErr }, { status: 400 });

  const passwordHash = hashPassword(password);

  try {
    await prisma.user.create({ data: { email, username, passwordHash } });
  } catch (err) {
    // Colisao de unico (email/usuario ja em uso).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | string | undefined) ?? "";
      const field = Array.isArray(target) ? target.join(",") : String(target);
      const msg = field.includes("email")
        ? "Este email ja esta cadastrado"
        : "Este usuario ja esta em uso";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Falha ao cadastrar";
    console.error("Erro no registro:", message);
    return NextResponse.json(
      { error: "Falha ao cadastrar. Tente novamente." },
      { status: 500 }
    );
  }

  const token = createSessionToken(username);
  const response = NextResponse.json({ ok: true, name: username });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
