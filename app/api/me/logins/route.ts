import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/me/logins — historico do PRIMEIRO login de cada usuario no painel.
// Exclusivo do master (asrus12). Devolve apenas o nick e a data/hora — nada
// alem disso. Ordenado do mais recente para o mais antigo.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  if (!session.master) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  let logins: { login: string; display: string; firstLoginAt: string }[] = [];
  try {
    const rows = await prisma.loginHistory.findMany({
      orderBy: { firstLoginAt: "desc" },
      take: 500,
    });
    logins = rows.map((r) => ({
      login: r.login,
      display: r.display || r.login,
      firstLoginAt: r.firstLoginAt.toISOString(),
    }));
  } catch (err) {
    console.warn("[me/logins] falha ao ler:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ logins });
}
