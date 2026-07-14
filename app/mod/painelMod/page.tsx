import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { modSlug } from "@/lib/accounts";
import { PainelClient } from "./PainelClient";

// A checagem "de verdade" acontece nas rotas de API (secao 6). Aqui validamos
// a assinatura do cookie no servidor para ja ter o nome do mod no primeiro
// render — e barrar quem forjou so a presenca do cookie para passar o
// middleware.
export default function PainelPage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    redirect("/mod/painelMod/login");
  }

  // Config do feed ao vivo (VDO.Ninja). Lida SO no servidor e repassada
  // apenas para o painel autenticado, para a sala nao vazar no bundle publico.
  const vdoRoom = process.env.VDO_ROOM || "";
  const vdoPassword = process.env.VDO_PASSWORD || "";
  // Canal da Twitch para usar a propria transmissao como fundo da mesa
  // (nao exige o streamer abrir nada — a live ja esta no ar).
  const twitchChannel = process.env.TWITCH_CHANNEL || "";

  return (
    <PainelClient
      modName={session.name}
      modSlug={modSlug(session.name)}
      vdoRoom={vdoRoom}
      vdoPassword={vdoPassword}
      twitchChannel={twitchChannel}
    />
  );
}
