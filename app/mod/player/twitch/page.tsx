import { canalDaEntrada, isQualidade, QUALIDADE_PADRAO } from "@/lib/twitch-player";
import { TwitchPlayer } from "./TwitchPlayer";

// Pagina do player da Twitch usada como item EMBED da mesa.
//
// Ela existe porque a qualidade so pode ser imposta pela API JS do embed, que
// precisa rodar numa pagina nossa (ver lib/twitch-player.ts). Nao tem nada
// alem do player: fundo transparente, sem margem, para caber no retangulo do
// item igual aos outros feeds.
export const dynamic = "force-dynamic";

export default function PlayerTwitchPage({
  searchParams,
}: {
  searchParams: { canal?: string; q?: string; audio?: string };
}) {
  const canal = canalDaEntrada(searchParams.canal || "");
  const qualidade = isQualidade(searchParams.q) ? searchParams.q : QUALIDADE_PADRAO;
  const comAudio = searchParams.audio === "1";

  if (!canal) {
    return (
      <main className="twitch-player">
        <p className="twitch-erro">Informe o canal da Twitch (?canal=).</p>
      </main>
    );
  }

  return (
    <main className="twitch-player">
      <TwitchPlayer canal={canal} qualidade={qualidade} comAudio={comAudio} />
    </main>
  );
}
