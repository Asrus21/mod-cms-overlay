import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishMove } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";

// POST /api/trigger/ocultar-tudo — oculta TODOS os itens visiveis deste mod
// nos overlays dos streamers. Chamado pela mesa quando a aba do canvas fecha,
// para nada ficar esquecido na tela de um streamer sem ninguem cuidando.
//
// Vem por navigator.sendBeacon, disparado no `pagehide`: e o unico jeito de um
// pedido sobreviver ao fechamento da aba. Isso tem duas consequencias aqui:
//  - nao ha quem leia a resposta, entao ela e so informativa;
//  - nao da para mandar corpo JSON de forma confiavel, entao a rota nao recebe
//    nada alem do cookie da sessao: tudo e decidido pelo dono dos itens.
//
// OCULTA, nao remove: o item continua na mesa, so que escondido, e o mod o
// mostra de novo quando voltar.
//
// A propria mesa do usuario fica de fora: la nao ha "streamer desavisado" — e
// o proprio canal, e um streamer pode querer deixar o overlay dele montado com
// o painel fechado.
//
// Sem checagem de acesso por canal, de proposito: a rota so mexe nos itens do
// PROPRIO mod e so para esconde-los. Mesmo quem perdeu o acesso a uma mesa
// deve conseguir tirar dela o que deixou a mostra.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const owner = modSlug(session.name);
  const meuCanal = streamerSlug(session.name);

  let visiveis: Awaited<ReturnType<typeof prisma.overlayState.findMany>> = [];
  try {
    visiveis = await prisma.overlayState.findMany({
      where: { owner, hidden: false, NOT: { streamer: meuCanal } },
    });
  } catch (err) {
    console.warn("[ocultar-tudo] falha ao ler:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, ocultados: 0 }, { status: 500 });
  }
  if (visiveis.length === 0) return NextResponse.json({ ok: true, ocultados: 0 });

  // Banco PRIMEIRO: se o OBS do streamer recarregar, o item ja volta oculto,
  // mesmo que o aviso em tempo real abaixo falhe.
  try {
    await prisma.overlayState.updateMany({
      where: { id: { in: visiveis.map((v) => v.id) }, owner },
      data: { hidden: true },
    });
  } catch (err) {
    console.warn("[ocultar-tudo] falha ao gravar:", err instanceof Error ? err.message : err);
  }

  // Depois o aviso ao vivo, um por item. allSettled: um canal com problema no
  // Pusher nao pode impedir os outros de serem escondidos.
  const agora = Date.now();
  const resultados = await Promise.allSettled(
    visiveis.map((v) =>
      publishMove(v.streamer, {
        itemId: v.id,
        mediaId: v.mediaId ?? "",
        x: v.x,
        y: v.y,
        scale: v.scale,
        scaleY: v.scaleY,
        volume: v.volume,
        muted: v.muted,
        hidden: true,
        triggeredAt: agora,
      })
    )
  );
  const falhas = resultados.filter((r) => r.status === "rejected").length;
  if (falhas) console.warn(`[ocultar-tudo] ${falhas} aviso(s) ao vivo falharam`);

  return NextResponse.json({
    ok: true,
    ocultados: visiveis.length,
    canais: Array.from(new Set(visiveis.map((v) => v.streamer))),
  });
}
