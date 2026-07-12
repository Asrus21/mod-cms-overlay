import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { ActionType } from "@prisma/client";

// POST /api/live — registra no log que um mod entrou ao vivo (secao 7:
// accountability). O feed em si trafega pelo VDO.Ninja, nao pelo backend;
// aqui so guardamos "quem foi ao vivo e quando".
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as { kind?: string };
  const kind = body.kind === "screen" ? "tela" : "camera";

  await prisma.auditLog.create({
    data: {
      action: ActionType.LIVE,
      actor: session.name,
      mediaName: kind,
    },
  });

  return NextResponse.json({ ok: true });
}
