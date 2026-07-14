"use client";

import { OverlayItems, useOverlayItems } from "./overlay-items";

// Overlay de UM streamer (Browser Source no OBS). Varios mods publicam nele;
// mostra todos os itens de todos os mods daquele streamer. Sem UI e com fundo
// transparente: so ouve a camada de tempo real e reage.
export function OverlayView({ streamer }: { streamer: string }) {
  const items = useOverlayItems(streamer);

  return (
    <div className="overlay-root">
      <OverlayItems items={items} />
    </div>
  );
}
