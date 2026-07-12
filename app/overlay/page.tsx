"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Pusher from "pusher-js";
import {
  EVENT_CLEAR,
  EVENT_MOVE,
  EVENT_SHOW,
  OVERLAY_CHANNEL,
  type ClearPayload,
  type MovePayload,
  type ShowMediaPayload,
} from "@/lib/realtime";

type Placed = {
  media: ShowMediaPayload;
  x: number;
  y: number;
  scale: number;
};

// Pagina "tela em branco" carregada como Browser Source no OBS (secao 2.2).
// Sem UI de controle: so ouve a camada de tempo real e reage. Alem de
// mostrar/limpar, acompanha a posicao/escala enviadas em tempo real pela
// mesa de controle (evento media:move).
export default function OverlayPage() {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTriggeredAtRef = useRef(0);
  // Ultima atualizacao de posicao aplicada, para descartar moves que chegarem
  // fora de ordem pela rede (evita "pulos" da imagem).
  const lastMoveAtRef = useRef(0);

  function clearOverlay() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setPlaced(null);
  }

  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY || "", {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
    });

    const channel = pusher.subscribe(OVERLAY_CHANNEL);

    channel.bind(EVENT_SHOW, (payload: ShowMediaPayload) => {
      if (payload.triggeredAt < currentTriggeredAtRef.current) return;
      currentTriggeredAtRef.current = payload.triggeredAt;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      lastMoveAtRef.current = payload.triggeredAt;

      setPlaced({
        media: payload,
        x: payload.x ?? 0.5,
        y: payload.y ?? 0.5,
        scale: payload.scale ?? 1,
      });

      // sticky (mesa) nao some sozinho; flash some depois de durationMs.
      if (!payload.sticky && payload.durationMs > 0) {
        timeoutRef.current = setTimeout(clearOverlay, payload.durationMs);
      }
    });

    channel.bind(EVENT_MOVE, (payload: MovePayload) => {
      if (payload.triggeredAt < lastMoveAtRef.current) return; // fora de ordem
      lastMoveAtRef.current = payload.triggeredAt;
      // So move se for a midia atualmente na tela.
      setPlaced((prev) =>
        prev && prev.media.mediaId === payload.mediaId
          ? { ...prev, x: payload.x, y: payload.y, scale: payload.scale }
          : prev
      );
    });

    channel.bind(EVENT_CLEAR, (payload: ClearPayload) => {
      currentTriggeredAtRef.current = Math.max(currentTriggeredAtRef.current, payload.triggeredAt);
      clearOverlay();
    });

    return () => {
      pusher.unsubscribe(OVERLAY_CHANNEL);
      pusher.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!placed) return <div className="overlay-root" />;

  // Posiciona pelo centro da midia via transform (suave e performatico).
  // A pequena transicao interpola entre as atualizacoes de rede, deixando o
  // movimento fluido mesmo recebendo ~15-20 updates por segundo.
  const style: CSSProperties = {
    "--x": placed.x,
    "--y": placed.y,
    "--s": placed.scale,
  } as CSSProperties;

  return (
    <div className="overlay-root">
      {placed.media.type === "AUDIO" ? (
        <audio src={placed.media.url} autoPlay />
      ) : (
        <div className="overlay-movable" style={style}>
          {placed.media.type === "VIDEO" ? (
            <video className="overlay-media" src={placed.media.url} autoPlay playsInline />
          ) : (
            <img className="overlay-media" src={placed.media.url} alt="" />
          )}
        </div>
      )}
    </div>
  );
}
