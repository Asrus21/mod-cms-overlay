import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishShowMedia } from "@/lib/realtime";
import { ActionType } from "@prisma/client";

const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 5 * 60 * 1000;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

// POST /api/trigger/show — cenario "mostrar midia" (secao 3), passos 3-5:
// autoriza, registra auditoria e publica o evento de exibicao.
// Suporta dois modos:
//  - flash: dura `durationMs` e some sozinho (botao "Mostrar").
//  - sticky: fica na tela ate um clear/novo show (mesa de controle), com
//    posicao/escala iniciais.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json()) as {
    mediaId?: string;
    durationMs?: number;
    sticky?: boolean;
    x?: number;
    y?: number;
    scale?: number;
    scaleY?: number | null;
  };

  if (!body.mediaId) {
    return NextResponse.json({ error: "mediaId e obrigatorio" }, { status: 400 });
  }

  const sticky = Boolean(body.sticky);
  // No modo flash a duracao e obrigatoria e limitada; no sticky ela e ignorada.
  let durationMs = 0;
  if (!sticky) {
    if (!body.durationMs) {
      return NextResponse.json({ error: "durationMs e obrigatorio" }, { status: 400 });
    }
    if (body.durationMs < MIN_DURATION_MS || body.durationMs > MAX_DURATION_MS) {
      return NextResponse.json({ error: "durationMs fora do intervalo permitido" }, { status: 400 });
    }
    durationMs = body.durationMs;
  }

  const media = await prisma.media.findUnique({ where: { id: body.mediaId } });
  if (!media) {
    return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
  }

  // Posicao (0..1) e tamanho (fracao da largura da tela, 0.02..3).
  const x = clamp(typeof body.x === "number" ? body.x : 0.5, 0, 1);
  const y = clamp(typeof body.y === "number" ? body.y : 0.5, 0, 1);
  const scale = clamp(typeof body.scale === "number" ? body.scale : 0.5, 0.005, 3);
  // scaleY nulo/ausente = altura natural (mantem a proporcao, sem distorcer).
  const scaleY =
    typeof body.scaleY === "number" ? clamp(body.scaleY, 0.005, 3) : null;

  // Publica primeiro; so registra no log se o overlay realmente foi acionado.
  try {
    await publishShowMedia({
      mediaId: media.id,
      url: media.url,
      type: media.type,
      durationMs,
      triggeredAt: Date.now(),
      sticky,
      x,
      y,
      scale,
      scaleY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao publicar no overlay";
    console.error("Erro no show:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Guarda o estado atual para o overlay recuperar ao (re)carregar no OBS.
  const stateData = {
    mediaId: media.id,
    url: media.url,
    type: media.type,
    x,
    y,
    scale,
    scaleY,
    sticky,
    expiresAt: sticky ? null : new Date(Date.now() + durationMs),
  };
  // Best-effort: se a tabela OverlayState ainda nao existe (db push nao
  // pegou), o disparo ja aconteceu; so perdemos a recuperacao de estado.
  try {
    await prisma.overlayState.upsert({
      where: { id: "current" },
      update: stateData,
      create: { id: "current", ...stateData },
    });
  } catch (err) {
    console.warn("[overlayState] upsert ignorado:", err instanceof Error ? err.message : err);
  }

  await prisma.auditLog.create({
    data: {
      action: ActionType.SHOW,
      actor: session.name,
      mediaId: media.id,
      mediaName: media.name,
      durationMs: sticky ? null : durationMs,
    },
  });

  return NextResponse.json({ ok: true });
}
