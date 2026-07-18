import type { NextRequest } from "next/server";

// Origem "publica" do request. Sob o proxy do asrus.app, o host real chega em
// x-forwarded-host; caindo para o host direto quando acessado sem proxy. Usado
// para montar o link de redefinicao de senha no dominio certo.
export function publicOrigin(request: NextRequest): string {
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
