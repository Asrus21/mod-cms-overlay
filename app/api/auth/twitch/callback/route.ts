import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { publicOrigin } from "@/lib/origin";
import {
  exchangeCode,
  getCurrentUser,
  getModeratedChannels,
  isMaster,
} from "@/lib/twitch";

// GET /api/auth/twitch/callback — retorno do OAuth da Twitch. Valida o state,
// troca o code por token, le o usuario e os canais que ele modera, salva a
// lista no banco e cria a sessao. Redireciona para o painel.
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const loginUrl = new URL("/mod/painelMod/login", origin);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = request.cookies.get("tw_oauth_state")?.value;

  if (url.searchParams.get("error")) {
    loginUrl.searchParams.set("erro", "twitch");
    return NextResponse.redirect(loginUrl);
  }
  if (!code || !state || !savedState || state !== savedState) {
    loginUrl.searchParams.set("erro", "state");
    return NextResponse.redirect(loginUrl);
  }

  const redirectUri =
    process.env.TWITCH_REDIRECT_URI || `${origin}/api/auth/twitch/callback`;

  try {
    const accessToken = await exchangeCode(code, redirectUri);
    const user = await getCurrentUser(accessToken);
    const login = user.login.toLowerCase();

    // Atualiza a lista de canais moderados deste mod (substitui a anterior).
    try {
      const channels = await getModeratedChannels(accessToken, user.id);
      await prisma.$transaction([
        prisma.moderatedChannel.deleteMany({ where: { modLogin: login } }),
        ...(channels.length
          ? [
              prisma.moderatedChannel.createMany({
                data: channels.map((c) => ({
                  modLogin: login,
                  broadcasterId: c.broadcasterId,
                  broadcasterLogin: c.broadcasterLogin.toLowerCase(),
                  broadcasterName: c.broadcasterName,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    } catch (err) {
      // Nao bloqueia o login se a lista falhar (ex.: escopo/banco). Loga.
      console.warn("[twitch] falha ao salvar canais moderados:", err instanceof Error ? err.message : err);
    }

    // Registra o PRIMEIRO login deste usuario (nao sobrescreve a data se ja
    // existir). Best-effort: nao bloqueia o login se falhar.
    try {
      await prisma.loginHistory.upsert({
        where: { login },
        update: { display: user.displayName },
        create: { login, display: user.displayName },
      });
    } catch (err) {
      console.warn("[twitch] falha ao registrar historico de login:", err instanceof Error ? err.message : err);
    }

    const token = createSessionToken({
      name: login,
      display: user.displayName,
      photo: user.profileImageUrl,
      master: isMaster(login),
    });

    const res = NextResponse.redirect(new URL("/mod/painelMod", origin));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    res.cookies.delete("tw_oauth_state");
    return res;
  } catch (err) {
    console.error("[twitch] callback falhou:", err instanceof Error ? err.message : err);
    loginUrl.searchParams.set("erro", "login");
    return NextResponse.redirect(loginUrl);
  }
}
