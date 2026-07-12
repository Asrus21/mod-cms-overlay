import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type ModSession } from "./session";

// Secao 6: toda acao sensivel e validada no backend a cada chamada, nunca
// confiando apenas na UI. Usado por toda rota de API que muta estado
// (mostrar midia, limpar, cadastrar midia).
export function requireMod(request: NextRequest):
  | { session: ModSession; response: null }
  | { session: null; response: NextResponse } {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }),
    };
  }

  return { session, response: null };
}
