import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/audit — historico simples do ultimo disparo (secao 2.1) e log
// de auditoria (secao 7).
export async function GET(request: NextRequest) {
  const { response } = requireMod(request);
  if (response) return response;

  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ entries });
}
