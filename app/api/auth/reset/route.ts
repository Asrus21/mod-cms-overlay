import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashResetToken } from "@/lib/reset-token";
import { hashPassword } from "@/lib/password";
import { validatePassword } from "@/lib/users";

// POST /api/auth/reset — redefine a senha usando o token do email. Valida o
// token (existe, nao usado, nao expirado), troca a senha e MARCA o token como
// usado (uso unico), removendo os demais tokens do usuario.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
  } | null;

  const token = (body?.token || "").trim();
  const password = body?.password || "";

  if (!token) {
    return NextResponse.json({ error: "Link invalido" }, { status: 400 });
  }
  const passErr = validatePassword(password);
  if (passErr) return NextResponse.json({ error: passErr }, { status: 400 });

  const tokenHash = hashResetToken(token);

  try {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Link invalido ou expirado. Peca um novo em 'Esqueci a senha'." },
        { status: 400 }
      );
    }

    const passwordHash = hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // Uso unico + limpa quaisquer outros tokens do usuario.
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset] falha:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Falha ao redefinir a senha. Tente novamente." },
      { status: 500 }
    );
  }
}
