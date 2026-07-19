import { prisma } from "./db";

// Regras de acesso a mesa de um streamer.
// Uma pessoa PODE controlar/gerenciar a mesa de `streamer` se:
//   - e o usuario master (asrus12), OU
//   - e o proprio streamer (login == streamer), OU
//   - modera aquele canal na Twitch (ModeratedChannel), OU
//   - recebeu acesso concedido no painel (MesaAccess).
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
    const mod = await prisma.moderatedChannel.findFirst({
      where: { modLogin: me, broadcasterLogin: s },
    });
    if (mod) return true;
    const grant = await prisma.mesaAccess.findUnique({
      where: { streamer_userLogin: { streamer: s, userLogin: me } },
    });
    return Boolean(grant);
  } catch {
    return false;
  }
}
