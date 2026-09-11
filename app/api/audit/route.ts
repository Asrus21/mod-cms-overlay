import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/audit — historico simples do ultimo disparo (secao 2.1) e log
// de auditoria (secao 7).
//
// Como a biblioteca e privada por usuario, o log tambem e: cada um so ve as
// PROPRIAS acoes (o log guarda o nome da midia, que nao pode vazar para outra
// pessoa). O master (asrus12) ve o log completo, para auditoria.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const entries = await prisma.auditLog.findMany({
    where: session.master
      ? undefined
      : { actor: { equals: session.name.trim().toLowerCase(), mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ entries });
}
