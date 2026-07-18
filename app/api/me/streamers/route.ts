import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/me/streamers — canais que o mod logado modera (para o painel listar).
// Tambem devolve se ele e master (asrus12), que pode buscar qualquer streamer.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  let channels: { login: string; name: string }[] = [];
  try {
    const rows = await prisma.moderatedChannel.findMany({
      where: { modLogin: session.name },
      orderBy: { broadcasterName: "asc" },
    });
    channels = rows.map((r) => ({ login: r.broadcasterLogin, name: r.broadcasterName }));
  } catch (err) {
    console.warn("[me/streamers] falha ao ler:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({
    master: session.master,
    display: session.display,
    photo: session.photo,
    login: session.name,
    streamers: channels,
  });
}
