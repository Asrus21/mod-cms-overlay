import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishRemove } from "@/lib/realtime";
import { modSlug, streamerSlug } from "@/lib/accounts";

// POST /api/trigger/remove — remove UM item da tela (botao ✕ na midia). Ao
// contrario do /clear (que limpa tudo), aqui so o item indicado sai. Publica o
// evento e apaga a linha persistida do item (best-effort).
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    streamer?: string;
  } | null;
  if (!body?.itemId) {
    return NextResponse.json({ error: "itemId e obrigatorio" }, { status: 400 });
  }
  const streamer = streamerSlug(body.streamer || "");
  if (!streamer) {
    return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  }

  try {
    await publishRemove(streamer, { itemId: body.itemId, triggeredAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao remover";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    await prisma.overlayState.deleteMany({ where: { id: body.itemId, owner } });
  } catch {
    // best-effort; o overlay ja recebeu ao vivo.
  }

  return NextResponse.json({ ok: true });
}
