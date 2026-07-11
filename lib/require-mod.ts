import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

// Secao 6: toda acao sensivel e validada no backend a cada chamada, nunca
// confiando apenas na UI do painel esconder/mostrar botoes. Usado por toda
// rota de API que mute estado (mostrar midia, limpar, cadastrar midia).
export async function requireMod() {
  const session = await getServerSession(authOptions);

  if (!session?.isMod || !session.modId) {
    return {
      session: null,
      response: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }),
    } as const;
  }

  return { session, response: null } as const;
}
