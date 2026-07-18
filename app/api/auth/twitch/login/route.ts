import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthorizeUrl, twitchConfigured } from "@/lib/twitch";
import { publicOrigin } from "@/lib/origin";

// GET /api/auth/twitch/login — inicia o OAuth da Twitch. Gera um `state`
// (anti-CSRF) guardado num cookie curto e redireciona para a Twitch.
export function GET(request: NextRequest) {
  if (!twitchConfigured()) {
    return NextResponse.json(
      { error: "Login via Twitch nao configurado (defina TWITCH_CLIENT_ID/SECRET)." },
      { status: 503 }
    );
  }

  const redirectUri =
    process.env.TWITCH_REDIRECT_URI || `${publicOrigin(request)}/api/auth/twitch/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const res = NextResponse.redirect(getAuthorizeUrl(redirectUri, state));
  res.cookies.set("tw_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}
