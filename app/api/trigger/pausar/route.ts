import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { canControlStreamer } from "@/lib/access";
import { publishMove } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";

// POST /api/trigger/pausar — botao "Parar"/"Continuar" de UMA mesa.
// body: { streamer, acao: "parar" | "continuar" }
//
//  - parar: esconde tudo o que este mod tem VISIVEL neste streamer e marca
//    esses itens como `pausado`;
//  - continuar: mostra de novo SO os itens marcados pelo parar. O que ja estava
//    oculto antes continua oculto.
//
// Trocar de mesa nao passa por aqui: os itens de uma mesa ficam como estao ao
// abrir outra. Fechar a aba e outra historia — ver /api/trigger/ocultar-tudo,
// que oculta tudo de vez, sem marcar pausa.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as {
    streamer?: string;
    acao?: string;
  } | null;
  const streamer = streamerSlug(body?.streamer || "");
  const acao = body?.acao;
  if (!streamer) return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  if (acao !== "parar" && acao !== "continuar") {
    return NextResponse.json({ error: "acao deve ser parar ou continuar" }, { status: 400 });
  }
  // Continuar poe coisas na tela do streamer: exige acesso como qualquer show.
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Você não tem acesso à mesa deste streamer." }, { status: 403 });
  }

  const parar = acao === "parar";
  let alvo: Awaited<ReturnType<typeof prisma.overlayState.findMany>> = [];
  try {
    alvo = await prisma.overlayState.findMany({
      where: parar
        ? { owner, streamer, hidden: false }
        : { owner, streamer, pausado: true },
    });
    if (alvo.length) {
      // Banco primeiro: um OBS que recarregue no meio ja ve o estado certo.
      await prisma.overlayState.updateMany({
        where: { id: { in: alvo.map((a) => a.id) }, owner },
        data: parar ? { hidden: true, pausado: true } : { hidden: false, pausado: false },
      });
    }
  } catch (err) {
    console.error("[pausar] falha no banco:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Falha ao gravar" }, { status: 500 });
  }

  const agora = Date.now();
  const resultados = await Promise.allSettled(
    alvo.map((a) =>
      publishMove(streamer, {
        itemId: a.id,
        mediaId: a.mediaId ?? "",
        x: a.x,
        y: a.y,
        scale: a.scale,
        scaleY: a.scaleY,
        volume: a.volume,
        muted: a.muted,
        hidden: parar,
        triggeredAt: agora,
      })
    )
  );
  const falhas = resultados.filter((r) => r.status === "rejected").length;
  if (falhas) console.warn(`[pausar] ${falhas} aviso(s) ao vivo falharam`);

  return NextResponse.json({ ok: true, acao, itens: alvo.map((a) => a.id), falhasAoVivo: falhas });
}
