// Protege as paginas do painel (/painel/*). A autorizacao "de verdade"
// acontece em cada rota de API (lib/require-mod.ts, secao 6) verificando a
// ASSINATURA do cookie; aqui no edge fazemos apenas a checagem barata de
// presenca do cookie para redirecionar cedo quem nem logou. A pagina de
// login em si fica liberada.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export const config = {
  matcher: ["/painel/:path*"],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/painel/login") {
    return NextResponse.next();
  }

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/painel/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
