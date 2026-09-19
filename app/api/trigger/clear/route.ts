import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { canControlStreamer } from "@/lib/access";
import { publishClear } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";
import { ActionType } from "@prisma/client";

// POST /api/trigger/clear — "limpar minha mesa": remove do overlay do streamer
// apenas os itens do PROPRIO mod (nao afeta os itens de outros mods no mesmo
// overlay). Autoriza, audita e publica o evento de limpeza por dono.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as { streamer?: string } | null;
  const streamer = streamerSlug(body?.streamer || "");
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

  try {
    await publishClear(streamer, { owner, triggeredAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao limpar overlay";
    console.error("Erro no clear:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Zera os itens DESTE mod NESTE streamer. Best-effort.
  try {
    await prisma.overlayState.deleteMany({ where: { streamer, owner } });
  } catch (err) {
    console.warn("[overlayState] limpeza ignorada:", err instanceof Error ? err.message : err);
  }

  await prisma.auditLog.create({
    data: {
      action: ActionType.CLEAR,
      actor: session.name,
    },
  });

  return NextResponse.json({ ok: true });
}
