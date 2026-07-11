"use client";

import { useEffect, useRef, useState } from "react";
import Pusher from "pusher-js";
import {
  EVENT_CLEAR,
  EVENT_SHOW,
  OVERLAY_CHANNEL,
  type ClearPayload,
  type ShowMediaPayload,
} from "@/lib/realtime";

// Pagina "tela em branco" carregada como Browser Source no OBS (secao 2.2).
// Sem UI de controle: so ouve a camada de tempo real e reage.
export default function OverlayPage() {
  const [current, setCurrent] = useState<ShowMediaPayload | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guarda o timestamp do disparo em exibicao para desempate: se um evento
  // "limpar" chegar depois do "mostrar" mais recente (mesmo fora de ordem
  // por latencia de rede), a limpeza sempre vence (secao 4, passo 6).
  const currentTriggeredAtRef = useRef(0);

  function clearOverlay() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setCurrent(null);
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
      setCurrent(payload);
      timeoutRef.current = setTimeout(clearOverlay, payload.durationMs);
    });

    channel.bind(EVENT_CLEAR, (payload: ClearPayload) => {
      // Limpeza sempre tem prioridade, mesmo que chegue "antes" no
      // timestamp de um show que ainda esta em transito.
      currentTriggeredAtRef.current = Math.max(currentTriggeredAtRef.current, payload.triggeredAt);
      clearOverlay();
    });

    return () => {
      pusher.unsubscribe(OVERLAY_CHANNEL);
      pusher.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="overlay-root">
      {current?.type === "VIDEO" ? (
        <video className="overlay-media" src={current.url} autoPlay muted />
      ) : current ? (
        <img className="overlay-media" src={current.url} alt="" />
      ) : null}
    </div>
  );
}
