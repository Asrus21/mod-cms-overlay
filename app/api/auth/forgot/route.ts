import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateResetToken, RESET_TOKEN_TTL_MS } from "@/lib/reset-token";
import { sendPasswordResetEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/users";
import { publicOrigin } from "@/lib/origin";

// POST /api/auth/forgot — "esqueci a senha". Recebe o email; se existir uma
// conta, gera um token NOVO (invalidando os anteriores), guarda o hash e envia
// o link por email. Sempre responde generico (nao revela se o email existe).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = normalizeEmail(body?.email || "");

  // Resposta generica padrao (evita enumeracao de emails cadastrados).
  const genericOk = NextResponse.json({
    ok: true,
    message: "Se houver uma conta com este email, enviamos um link para redefinir a senha.",
  });

  if (!email || !email.includes("@")) {
    return genericOk;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return genericOk;

    // Sempre um link novo: invalida os tokens anteriores do usuario.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const { token, tokenHash } = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${publicOrigin(request)}/mod/painelMod/redefinir?token=${token}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    // Nao vaza detalhe ao cliente; loga no servidor (ex.: RESEND nao configurado).
    console.error("[forgot] falha:", err instanceof Error ? err.message : err);
  }

  return genericOk;
}
