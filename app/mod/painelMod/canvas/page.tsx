import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { modSlug } from "@/lib/accounts";
import { CanvasClient } from "./CanvasClient";

// Tela exclusiva da mesa: o palco ocupa a tela inteira e os controles ficam
// em paineis flutuantes por cima (mesmo modelo do /canvas do Pogly). A mesma
// mesa do painel, so que sem o resto da pagina em volta.
export default function CanvasPage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    redirect("/mod/painelMod/login");
  }

  const vdoRoom = process.env.VDO_ROOM || "";
  const vdoPassword = process.env.VDO_PASSWORD || "";
  const twitchChannel = process.env.TWITCH_CHANNEL || "";

  return (
    <CanvasClient
      modName={session.display}
      modSlug={modSlug(session.name)}
      vdoRoom={vdoRoom}
      vdoPassword={vdoPassword}
      twitchChannel={twitchChannel}
    />
  );
}
