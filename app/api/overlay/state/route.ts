import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { streamerSlug, modSlug } from "@/lib/accounts";

// GET /api/overlay/state?streamer=<slug>[&owner=<mod>] — estado atual do
// overlay de um STREAMER (todos os itens dele) para o browser source do OBS
// recuperar o que esta na tela ao carregar/reconectar (o Pusher nao repete
// eventos). Publico de proposito. Com &owner=<mod>, filtra so os itens daquele
// mod — usado pela mesa (individual por mod) ao recarregar o painel.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const streamer = streamerSlug(request.nextUrl.searchParams.get("streamer") || "");
  if (!streamer) {
    return NextResponse.json({ items: [] });
  }
  const ownerParam = request.nextUrl.searchParams.get("owner");
  const owner = ownerParam ? modSlug(ownerParam) : null;

  let rows = null as Awaited<ReturnType<typeof prisma.overlayState.findMany>> | null;
  try {
    rows = await prisma.overlayState.findMany({
      where: owner ? { streamer, owner } : { streamer },
    });
  } catch {
    // Tabela pode ainda nao existir; trata como "nada na tela".
    return NextResponse.json({ items: [] });
  }

  const now = Date.now();

  // "flash" ja expirado nao deve reaparecer. Limpa do banco (best-effort).
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
      owner: r.owner,
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
