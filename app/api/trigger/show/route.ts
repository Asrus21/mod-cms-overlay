import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishShowMedia } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";
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
    itemId?: string;
    mediaId?: string;
    streamer?: string;
    type?: string;
    text?: string;
    durationMs?: number;
    sticky?: boolean;
    x?: number;
    y?: number;
    scale?: number;
    scaleY?: number | null;
    volume?: number;
    muted?: boolean;
    hidden?: boolean;
  };

  // Item de texto: nao tem midia na biblioteca; carrega o texto direto.
  const isText = body.type === "TEXT" || (!body.mediaId && typeof body.text === "string");
  const text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
  if (isText) {
    if (!text.trim()) {
      return NextResponse.json({ error: "Digite um texto" }, { status: 400 });
    }
  } else if (!body.mediaId) {
    return NextResponse.json({ error: "mediaId e obrigatorio" }, { status: 400 });
  }

  // Overlay por streamer: a midia vai para o overlay do streamer escolhido.
  const streamer = streamerSlug(body.streamer || "");
  if (!streamer) {
    return NextResponse.json({ error: "Escolha um streamer primeiro" }, { status: 400 });
  }

  // Cada exibicao e um "item" independente (varios coexistem). A mesa manda o
  // seu itemId; o flash ("Mostrar") nao manda, entao geramos um.
  const itemId =
    typeof body.itemId === "string" && body.itemId
      ? body.itemId
      : `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Mesa individual por mod: o dono do item e o mod logado.
  const owner = modSlug(session.name);

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

  // Resolve o conteudo do item: biblioteca (midia) ou texto.
  let mediaId: string | null = null;
  let url: string | null = null;
  let mediaType: "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";
  let mediaName: string;
  if (isText) {
    mediaType = "TEXT";
    mediaName = text.slice(0, 40);
  } else {
    const media = await prisma.media.findUnique({ where: { id: body.mediaId } });
    if (!media) {
      return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
    }
    mediaId = media.id;
    url = media.url;
    mediaType = media.type;
    mediaName = media.name;
  }

  // Posicao (0..1) e tamanho (fracao da largura da tela, 0.02..3).
  const x = clamp(typeof body.x === "number" ? body.x : 0.5, 0, 1);
  const y = clamp(typeof body.y === "number" ? body.y : 0.5, 0, 1);
  const scale = clamp(typeof body.scale === "number" ? body.scale : 0.5, 0.005, 3);
  // scaleY nulo/ausente = altura natural (mantem a proporcao, sem distorcer).
  const scaleY =
    typeof body.scaleY === "number" ? clamp(body.scaleY, 0.005, 3) : null;
  const volume = typeof body.volume === "number" ? clamp(body.volume, 0, 1) : 1;
  const muted = Boolean(body.muted);
  const hidden = Boolean(body.hidden);

  // Publica primeiro; so registra no log se o overlay realmente foi acionado.
  try {
    await publishShowMedia(streamer, {
      itemId,
      owner,
      mediaId: mediaId ?? "",
      url: url ?? "",
      type: mediaType,
      text: isText ? text : undefined,
      durationMs,
      triggeredAt: Date.now(),
      sticky,
      x,
      y,
      scale,
      scaleY,
      volume,
      muted,
      hidden,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao publicar no overlay";
    console.error("Erro no show:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Guarda o estado atual para o overlay recuperar ao (re)carregar no OBS.
  const stateData = {
    streamer,
    owner,
    mediaId,
    url,
    type: mediaType,
    text: isText ? text : null,
    x,
    y,
    scale,
    scaleY,
    volume,
    muted,
    hidden,
    sticky,
    expiresAt: sticky ? null : new Date(Date.now() + durationMs),
  };
  // Best-effort: se a tabela OverlayState ainda nao existe (db push nao
  // pegou), o disparo ja aconteceu; so perdemos a recuperacao de estado.
  try {
    await prisma.overlayState.upsert({
      where: { id: itemId },
      update: stateData,
      create: { id: itemId, ...stateData },
    });
  } catch (err) {
    console.warn("[overlayState] upsert ignorado:", err instanceof Error ? err.message : err);
  }

  await prisma.auditLog.create({
    data: {
      action: ActionType.SHOW,
      actor: session.name,
      mediaId,
      mediaName,
      durationMs: sticky ? null : durationMs,
    },
  });

  return NextResponse.json({ ok: true, itemId });
}
