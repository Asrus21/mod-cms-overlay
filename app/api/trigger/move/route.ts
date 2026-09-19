import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { canControlStreamer } from "@/lib/access";
import { publishMove } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";
import { clampPos } from "@/lib/stage";

// POST /api/trigger/move — atualiza a posicao/escala/som de UM item na tela em
// tempo real (mesa de controle). Chamada com alta frequencia enquanto o mod
// arrasta o mouse, entao por padrao NAO grava no banco: apenas repassa para o
// overlay via camada de tempo real. Quando `commit` = true (fim de arrasto,
// toggles), tambem persiste o estado do item para recuperar no OBS ao recarregar.
// Coordenadas normalizadas (0..1) para independer da resolucao do OBS.
function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    mediaId?: string;
    streamer?: string;
    x?: number;
    y?: number;
    scale?: number;
    scaleY?: number | null;
    volume?: number;
    muted?: boolean;
    hidden?: boolean;
    commit?: boolean;
  } | null;

  if (!body?.itemId || typeof body.x !== "number" || typeof body.y !== "number") {
    return NextResponse.json({ error: "itemId, x e y sao obrigatorios" }, { status: 400 });
  }
  const streamer = streamerSlug(body.streamer || "");
  if (!streamer) {
    return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  }

  // Quem pode mexer na mesa deste streamer? So o proprio, o master, ou quem
  // recebeu acesso (convite aceito). Sem esta checagem o convite nao protegeria
  // nada: bastava mandar outro `streamer` no corpo do pedido para publicar no
  // overlay de qualquer um.
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json(
      { error: "Você não tem acesso à mesa deste streamer." },
      { status: 403 }
    );
  }

  // scaleY nulo/ausente = altura natural (mantem a proporcao, sem distorcer).
  const scaleY =
    typeof body.scaleY === "number" ? clamp(body.scaleY, 0.005, 3) : null;
  // Fora de 0..1 = estacionado fora da tela (o overlay corta). Ver lib/stage.
  const x = clampPos(body.x);
  const y = clampPos(body.y);
  const scale = clamp(typeof body.scale === "number" ? body.scale : 0.5, 0.005, 3);
  const volume = typeof body.volume === "number" ? clamp(body.volume, 0, 1) : 1;
  const muted = Boolean(body.muted);
  // hidden so e enviado quando muda (toggle); undefined = mantem o estado atual.
  const hidden = typeof body.hidden === "boolean" ? body.hidden : undefined;

  try {
    await publishMove(streamer, {
      itemId: body.itemId,
      mediaId: body.mediaId || "",
      x,
      y,
      scale,
      scaleY,
      volume,
      muted,
      hidden,
      triggeredAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao mover";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Persiste o estado final do item (best-effort) para recuperar no OBS ao
  // recarregar. So no commit (fim de arrasto/toggle), nao em cada frame.
  if (body.commit) {
    try {
      await prisma.overlayState.updateMany({
        where: { id: body.itemId, owner },
        data: {
          x,
          y,
          scale,
          scaleY,
          volume,
          muted,
          ...(typeof hidden === "boolean" ? { hidden } : {}),
        },
      });
    } catch {
      // best-effort; o overlay ja recebeu ao vivo.
    }
  }

  return NextResponse.json({ ok: true });
}
