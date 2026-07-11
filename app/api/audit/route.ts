import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/audit — historico simples do ultimo disparo (secao 2.1) e log
// de auditoria completo (secao 7).
export async function GET() {
  const { response } = await requireMod();
  if (response) return response;

  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      mod: { select: { displayName: true, twitchLogin: true } },
      media: { select: { name: true } },
    },
  });

  return NextResponse.json({ entries });
}
