import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/overlay/state — estado atual do overlay para o browser source do
// OBS recuperar o que esta na tela ao carregar/reconectar (o Pusher nao
// repete eventos). Publico de proposito: o overlay roda no OBS sem login, e
// so devolve o que ja esta visivel na live.
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await prisma.overlayState.findUnique({ where: { id: "current" } });

  if (!s || !s.mediaId || !s.url) {
    return NextResponse.json({ state: null });
  }
  // "flash" ja expirado nao deve reaparecer.
  if (s.expiresAt && s.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ state: null });
  }

  return NextResponse.json({
    state: {
      mediaId: s.mediaId,
      url: s.url,
      type: s.type,
      x: s.x,
      y: s.y,
      scale: s.scale,
      sticky: s.sticky,
    },
  });
}
