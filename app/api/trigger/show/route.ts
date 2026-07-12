import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishShowMedia } from "@/lib/realtime";
import { ActionType } from "@prisma/client";

const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 5 * 60 * 1000;

// POST /api/trigger/show — cenario "mostrar midia" (secao 3), passos 3-5:
// autoriza, registra auditoria e publica o evento de exibicao.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json()) as { mediaId?: string; durationMs?: number };

  if (!body.mediaId || !body.durationMs) {
    return NextResponse.json({ error: "mediaId e durationMs sao obrigatorios" }, { status: 400 });
  }
  if (body.durationMs < MIN_DURATION_MS || body.durationMs > MAX_DURATION_MS) {
    return NextResponse.json({ error: "durationMs fora do intervalo permitido" }, { status: 400 });
  }

  const media = await prisma.media.findUnique({ where: { id: body.mediaId } });
  if (!media) {
    return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
  }

  await prisma.auditLog.create({
    data: {
      action: ActionType.SHOW,
      actor: session.name,
      mediaId: media.id,
      mediaName: media.name,
      durationMs: body.durationMs,
    },
  });

  await publishShowMedia({
    mediaId: media.id,
    url: media.url,
    type: media.type,
    durationMs: body.durationMs,
    triggeredAt: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
