// Protege as paginas do painel (/painel). A aplicacao das regras de
// autorizacao "de verdade" acontece em cada rota de API (lib/require-mod.ts,
// secao 6) — este middleware e so a camada de UX que evita renderizar o
// painel para quem nao esta logado ou nao e mod, redirecionando cedo.

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export const config = {
  matcher: ["/painel/:path*"],
};

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token || !token.isMod) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/auth/signin";
    url.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
