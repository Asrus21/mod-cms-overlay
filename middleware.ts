// Protege as paginas do painel (/mod/painelMod/*). A autorizacao "de verdade"
// acontece em cada rota de API (lib/require-mod.ts, secao 6) verificando a
// ASSINATURA do cookie; aqui no edge fazemos apenas a checagem barata de
// presenca do cookie para redirecionar cedo quem nem logou. A pagina de
// login em si fica liberada.
//
// O link antigo /painel (e sub-rotas) redireciona para /mod/painelMod para
// nao quebrar quem ja tinha salvo o endereco antigo.
//
// IMPORTANTE (proxy pelo asrus.app): este app tambem e servido atras do hub
// asrus.app (rewrite). `NextResponse.redirect` usa o host do REQUEST — que, sob
// o proxy, e o do projeto (mod-cms-overlay), fazendo o usuario "vazar" para fora
// do asrus.app. Por isso montamos o destino com o host ENCAMINHADO pelo proxy
// (x-forwarded-host = asrus.app quando vem pelo hub; senao o host direto).

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export const config = {
  matcher: ["/painel", "/painel/:path*", "/mod/painelMod", "/mod/painelMod/:path*"],
};

const LOGIN_PATH = "/mod/painelMod/login";
// Paginas de autenticacao publicas (sem exigir cookie): login, cadastro e o
// fluxo de recuperacao de senha.
const PUBLIC_PATHS = new Set([
  LOGIN_PATH,
  "/mod/painelMod/registro",
  "/mod/painelMod/esqueci",
  "/mod/painelMod/redefinir",
]);

// Origem "publica" do request: prioriza o host encaminhado pelo proxy (hub
// asrus.app), caindo para o host direto do projeto quando acessado sem proxy.
function publicOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ||
    request.nextUrl.protocol.replace(":", "") ||
    "https";
  return `${proto}://${host}`;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const origin = publicOrigin(request);

  // Redireciona o endereco antigo para o novo, preservando a sub-rota e a query.
  // /painel -> /mod/painelMod ; /painel/login -> /mod/painelMod/login ; etc.
  if (pathname === "/painel" || pathname.startsWith("/painel/")) {
    const dest = pathname.replace(/^\/painel/, "/mod/painelMod");
    return NextResponse.redirect(new URL(dest + search, origin), 308);
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasCookie) {
    const url = new URL(LOGIN_PATH, origin);
    url.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
