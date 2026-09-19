import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

// GET /api/me/streamers — canais cuja mesa o usuario logado pode controlar:
//   1. a MESA DELE MESMO (todo mundo que loga e streamer do proprio canal),
//   2. os canais a que ele recebeu acesso (convite aceito ou concessao),
//   3. so para o MASTER: tambem os canais que ele modera na Twitch.
//
// Moderar deixou de dar acesso por si so (ver lib/access.ts): para entrar na
// mesa de alguem agora e preciso um convite daquele streamer. A lista aqui
// segue a mesma regra, senao mostraria canais que o usuario nao consegue usar.
// A propria mesa vem sempre em primeiro na lista (marcada com `self`).
// Tambem devolve se ele e master (asrus12), que pode buscar qualquer streamer.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  type Channel = { login: string; name: string; self?: boolean };

  // A propria mesa: mesmo sem moderar ninguem, o usuario controla o overlay do
  // proprio canal (lib/access.ts ja libera quando login === streamer).
  const selfLogin = session.name.trim().toLowerCase();
  const self: Channel | null = selfLogin
    ? { login: selfLogin, name: session.display || selfLogin, self: true }
    : null;

  const byLogin = new Map<string, Channel>();
  if (self) byLogin.set(self.login, self);

  try {
    // So o master enxerga os canais que modera sem precisar de convite.
    if (session.master) {
      const mods = await prisma.moderatedChannel.findMany({
        where: { modLogin: session.name },
        orderBy: { broadcasterName: "asc" },
      });
      for (const r of mods) {
        if (byLogin.has(r.broadcasterLogin)) continue;
        byLogin.set(r.broadcasterLogin, { login: r.broadcasterLogin, name: r.broadcasterName });
      }
    }
    // Streamers cuja mesa ele recebeu acesso (convite aceito ou concessao).
    const grants = await prisma.mesaAccess.findMany({
      where: { userLogin: session.name },
      orderBy: { streamerName: "asc" },
    });
    for (const g of grants) {
      if (byLogin.has(g.streamer)) continue;
      byLogin.set(g.streamer, { login: g.streamer, name: g.streamerName || g.streamer });
    }
  } catch (err) {
    console.warn("[me/streamers] falha ao ler:", err instanceof Error ? err.message : err);
  }

  // A propria mesa primeiro; o resto em ordem alfabetica.
  const others = Array.from(byLogin.values())
    .filter((c) => !c.self)
    .sort((a, b) => a.name.localeCompare(b.name));
  const channels = self ? [self, ...others] : others;

  return NextResponse.json({
    master: session.master,
    display: session.display,
    photo: session.photo,
    login: session.name,
    streamers: channels,
  });
}
