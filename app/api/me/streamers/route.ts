import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/me/streamers — canais que o mod logado modera (para o painel listar).
// Tambem devolve se ele e master (asrus12), que pode buscar qualquer streamer.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const byLogin = new Map<string, { login: string; name: string }>();
  try {
    // Canais que ele modera na Twitch.
    const mods = await prisma.moderatedChannel.findMany({
      where: { modLogin: session.name },
      orderBy: { broadcasterName: "asc" },
    });
    for (const r of mods) {
      byLogin.set(r.broadcasterLogin, { login: r.broadcasterLogin, name: r.broadcasterName });
    }
    // Streamers cuja mesa ele recebeu acesso "na mao" (sem ser mod).
    const grants = await prisma.mesaAccess.findMany({
      where: { userLogin: session.name },
      orderBy: { streamerName: "asc" },
    });
    for (const g of grants) {
      if (!byLogin.has(g.streamer)) {
        byLogin.set(g.streamer, { login: g.streamer, name: g.streamerName || g.streamer });
      }
    }
  } catch (err) {
    console.warn("[me/streamers] falha ao ler:", err instanceof Error ? err.message : err);
  }
  const channels = Array.from(byLogin.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return NextResponse.json({
    master: session.master,
    display: session.display,
    photo: session.photo,
    login: session.name,
    streamers: channels,
  });
}
