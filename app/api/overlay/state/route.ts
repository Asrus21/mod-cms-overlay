import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/overlay/state — estado atual do overlay (TODOS os itens na tela)
// para o browser source do OBS recuperar o que esta na tela ao carregar/
// reconectar (o Pusher nao repete eventos). Publico de proposito: o overlay
// roda no OBS sem login, e so devolve o que ja esta visivel na live.
export const dynamic = "force-dynamic";

export async function GET() {
  let rows = null as Awaited<ReturnType<typeof prisma.overlayState.findMany>> | null;
  try {
    rows = await prisma.overlayState.findMany();
  } catch {
    // Tabela pode ainda nao existir; trata como "nada na tela".
    return NextResponse.json({ items: [] });
  }

  const now = Date.now();

  // "flash" ja expirado nao deve reaparecer. Limpa do banco de forma
  // best-effort (nao bloqueia a resposta se falhar).
  const expiredIds = rows
    .filter((r) => r.expiresAt && r.expiresAt.getTime() < now)
    .map((r) => r.id);
  if (expiredIds.length) {
    prisma.overlayState.deleteMany({ where: { id: { in: expiredIds } } }).catch(() => {});
  }

  const items = rows
    .filter((r) => r.mediaId && r.url && !(r.expiresAt && r.expiresAt.getTime() < now))
    .map((r) => ({
      itemId: r.id,
      mediaId: r.mediaId,
      url: r.url,
      type: r.type,
      x: r.x,
      y: r.y,
      scale: r.scale,
      scaleY: r.scaleY ?? null,
      volume: r.volume ?? 1,
      muted: r.muted ?? false,
      hidden: r.hidden ?? false,
      sticky: r.sticky,
    }));

  return NextResponse.json({ items });
}
