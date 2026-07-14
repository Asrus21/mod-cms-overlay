import { modSlug, streamerSlug } from "@/lib/accounts";
import { MesaView, type MesaBg } from "../../MesaView";

// Mesa permanente de um mod dentro de um streamer: /mesa/<streamer>/<mod>.
// Link fixo que o PROPRIO mod cola no Browser Source do OBS dele. Mostra o
// fundo escolhido (transmissao da Twitch ou sem fundo) com os itens desse mod
// por cima — os mesmos itens que aparecem no overlay do streamer.
//
// O fundo vem embutido no link (query params), gerado no painel:
//   ?fundo=twitch&canal=<canal>  -> usa a Twitch como fundo
//   (sem fundo)                  -> transparente, so os itens
export default function MesaObsPage({
  params,
  searchParams,
}: {
  params: { streamer: string; mod: string };
  searchParams: { fundo?: string; canal?: string };
}) {
  const streamer = streamerSlug(decodeURIComponent(params.streamer));
  const owner = modSlug(decodeURIComponent(params.mod));
  const bg: MesaBg = searchParams.fundo === "twitch" ? "twitch" : "none";
  const twitchChannel = (searchParams.canal || process.env.TWITCH_CHANNEL || "").trim();

  return (
    <MesaView streamer={streamer} owner={owner} bg={bg} twitchChannel={twitchChannel} />
  );
}
