import { prisma } from "./db";

// Regras de acesso a mesa de um streamer.
// Uma pessoa PODE controlar/gerenciar a mesa de `streamer` se:
//   - e o usuario master (asrus12), OU
//   - e o proprio streamer (login == streamer), OU
//   - recebeu acesso (MesaAccess) — na mao ou usando um codigo de convite.
//
// MODERAR O CANAL NA TWITCH NAO DA MAIS ACESSO. Antes dava, e isso significava
// que qualquer mod de um canal entrava na mesa daquele canal sem o streamer
// decidir nada. Agora o streamer gera um convite (lib/invites.ts) e entrega a
// quem quiser — que nem precisa ser mod. O master segue por cima da regra.
//
// A concessao usa a mesma regra: so quem ja tem acesso pode conceder a outrem.

export async function canControlStreamer(
  login: string,
  master: boolean,
  streamer: string
): Promise<boolean> {
  const me = login.trim().toLowerCase();
  const s = streamer.trim().toLowerCase();
  if (!s) return false;
  if (master) return true;
  if (me === s) return true;
  try {
    const grant = await prisma.mesaAccess.findUnique({
      where: { streamer_userLogin: { streamer: s, userLogin: me } },
    });
    return Boolean(grant);
  } catch {
    return false;
  }
}
