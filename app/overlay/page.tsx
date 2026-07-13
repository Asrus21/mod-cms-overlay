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
  // altura como fracao da tela; nulo = altura natural (mantem a proporcao).
  scaleY: number | null;
  volume: number;
  muted: boolean;
};

// Pagina "tela em branco" carregada como Browser Source no OBS (secao 2.2).
// Sem UI de controle: so ouve a camada de tempo real e reage. Alem de
// mostrar/limpar, acompanha a posicao/escala enviadas em tempo real pela
// mesa de controle (evento media:move).
export default function OverlayPage() {
  const [placed, setPlaced] = useState<Placed | null>(null);
  // Elemento de midia (video/audio) para aplicar volume/mudo via propriedade
  // do DOM (nao existe atributo/prop confiavel de "volume" no React).
  const mediaElRef = useRef<HTMLMediaElement | null>(null);
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

  // Busca o estado atual no servidor. Chamado ao carregar e a cada reconexao
  // do Pusher, para o overlay recuperar o que esta na tela mesmo tendo
  // perdido o evento ao vivo (Pusher nao repete eventos).
  async function syncState() {
    // Se um evento ao vivo (show/clear) chegar durante o fetch, nao
    // sobrescrevemos com o estado (possivelmente mais antigo) do banco.
    const startedAt = currentTriggeredAtRef.current;
    try {
      const res = await fetch("/api/overlay/state", { cache: "no-store" });
      if (!res.ok) return;
      const { state } = await res.json();
      if (currentTriggeredAtRef.current !== startedAt) return;
      if (!state) {
        setPlaced(null);
        return;
      }
      setPlaced({
        media: {
          mediaId: state.mediaId,
          url: state.url,
          type: state.type,
          durationMs: 0,
          triggeredAt: 0,
          sticky: state.sticky,
        },
        x: state.x,
        y: state.y,
        scale: state.scale,
        scaleY: state.scaleY ?? null,
        volume: typeof state.volume === "number" ? state.volume : 1,
        muted: Boolean(state.muted),
      });
    } catch {
      // silencioso; o Pusher ainda pode entregar ao vivo.
    }
  }

  useEffect(() => {
    syncState();

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY || "", {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
    });

    // Ao (re)conectar, re-sincroniza — cobre quedas de rede do browser source.
    pusher.connection.bind("connected", () => {
      syncState();
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
        scaleY: typeof payload.scaleY === "number" ? payload.scaleY : null,
        volume: typeof payload.volume === "number" ? payload.volume : 1,
        muted: Boolean(payload.muted),
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
          ? {
              ...prev,
              x: payload.x,
              y: payload.y,
              scale: payload.scale,
              scaleY: typeof payload.scaleY === "number" ? payload.scaleY : null,
              volume: typeof payload.volume === "number" ? payload.volume : prev.volume,
              muted: typeof payload.muted === "boolean" ? payload.muted : prev.muted,
            }
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

  // Aplica volume/mudo ao elemento (video/audio) sempre que mudarem. Feito via
  // propriedade do DOM porque nao ha prop confiavel de "volume" no React.
  useEffect(() => {
    const el = mediaElRef.current;
    if (!el) return;
    el.volume = placed ? placed.volume : 1;
    el.muted = placed ? placed.muted : false;
  }, [placed?.volume, placed?.muted, placed?.media.triggeredAt, placed?.media.type]);

  if (!placed) return <div className="overlay-root" />;

  // Posiciona pelo centro da midia via transform (suave e performatico).
  // A pequena transicao interpola entre as atualizacoes de rede, deixando o
  // movimento fluido mesmo recebendo ~15-20 updates por segundo.
  // scaleY definido => altura fixa (estica na vertical, pode distorcer);
  // nulo => altura natural (mantem a proporcao original).
  const stretched = placed.scaleY != null;
  const style: CSSProperties = {
    "--x": placed.x,
    "--y": placed.y,
    "--s": placed.scale,
    ...(stretched ? { "--sy": placed.scaleY } : {}),
  } as CSSProperties;

  return (
    <div className="overlay-root">
      {placed.media.type === "AUDIO" ? (
        // key = triggeredAt: re-disparar o mesmo audio recria o elemento e toca de novo.
        <audio
          key={placed.media.triggeredAt}
          ref={(el) => {
            mediaElRef.current = el;
          }}
          src={placed.media.url}
          autoPlay
        />
      ) : (
        <div className={`overlay-movable${stretched ? " stretched" : ""}`} style={style}>
          {placed.media.type === "VIDEO" ? (
            <video
              key={placed.media.triggeredAt}
              ref={(el) => {
                mediaElRef.current = el;
              }}
              className="overlay-media"
              src={placed.media.url}
              autoPlay
              loop
              playsInline
            />
          ) : (
            <img className="overlay-media" src={placed.media.url} alt="" />
          )}
        </div>
      )}
    </div>
  );
}
