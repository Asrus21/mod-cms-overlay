"use client";

import { useMemo } from "react";
import { OverlayItems, useOverlayItems } from "../overlay/overlay-items";

export type MesaBg = "none" | "twitch";

// Mesa de OBS do mod (Browser Source no OBS do proprio mod). Mostra o FUNDO
// escolhido (transmissao da Twitch ou sem fundo) com os itens desse mod por
// cima — os mesmos itens que vao para o overlay do streamer (mesa individual).
// So consome a camada de tempo real (websocket/Pusher); nada e publicado aqui.
export function MesaView({
  streamer,
  owner,
  bg,
  twitchChannel,
}: {
  streamer: string;
  owner: string;
  bg: MesaBg;
  twitchChannel: string;
}) {
  const all = useOverlayItems(streamer);
  // Mesa individual: so os itens do proprio mod (owner).
  const items = useMemo(
    () => (owner ? all.filter((it) => it.owner === owner) : all),
    [all, owner]
  );

  const twitchParent = typeof window !== "undefined" ? window.location.hostname : "";
  const twitchSrc =
    bg === "twitch" && twitchChannel && twitchParent
      ? `https://player.twitch.tv/?channel=${encodeURIComponent(
          twitchChannel
        )}&parent=${twitchParent}&muted=true&autoplay=true&controls=false`
      : "";

  return (
    <div className={`overlay-root mesa-obs-root${bg === "none" ? " transparent" : ""}`}>
      {twitchSrc && (
        <iframe
          className="mesa-obs-bg"
          src={twitchSrc}
          allow="autoplay; fullscreen"
          title="Transmissão da Twitch"
        />
      )}
      <OverlayItems items={items} />
    </div>
  );
}
