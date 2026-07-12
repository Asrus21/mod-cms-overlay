import { NextRequest, NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";
import { publishMove } from "@/lib/realtime";

// POST /api/trigger/move — atualiza a posicao/escala da midia na tela em
// tempo real (mesa de controle). Chamada com alta frequencia enquanto o mod
// arrasta o mouse, entao NAO grava no banco: apenas repassa para o overlay
// via camada de tempo real. Coordenadas normalizadas (0..1) para independer
// da resolucao do OBS.
function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export async function POST(request: NextRequest) {
  const { response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    mediaId?: string;
    x?: number;
    y?: number;
    scale?: number;
  } | null;

  if (!body?.mediaId || typeof body.x !== "number" || typeof body.y !== "number") {
    return NextResponse.json({ error: "mediaId, x e y sao obrigatorios" }, { status: 400 });
  }

  try {
    await publishMove({
      mediaId: body.mediaId,
      x: clamp(body.x, 0, 1),
      y: clamp(body.y, 0, 1),
      scale: clamp(typeof body.scale === "number" ? body.scale : 1, 0.1, 5),
      triggeredAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao mover";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
