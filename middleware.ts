// Protege as paginas do painel (/mod/painelMod/*). A autorizacao "de verdade"
// acontece em cada rota de API (lib/require-mod.ts, secao 6) verificando a
// ASSINATURA do cookie; aqui no edge fazemos apenas a checagem barata de
// presenca do cookie para redirecionar cedo quem nem logou. A pagina de
// login em si fica liberada.
//
// O link antigo /painel (e sub-rotas) redireciona para /mod/painelMod para
// nao quebrar quem ja tinha salvo o endereco antigo.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export const config = {
  matcher: ["/painel", "/painel/:path*", "/mod/painelMod", "/mod/painelMod/:path*"],
};

const LOGIN_PATH = "/mod/painelMod/login";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redireciona o endereco antigo para o novo, preservando a sub-rota.
  // /painel -> /mod/painelMod ; /painel/login -> /mod/painelMod/login ; etc.
  if (pathname === "/painel" || pathname.startsWith("/painel/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/painel/, "/mod/painelMod");
    return NextResponse.redirect(url, 308);
  }

  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
