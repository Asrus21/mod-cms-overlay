"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Pusher from "pusher-js";
import {
  EVENT_CLEAR,
  EVENT_MOVE,
  EVENT_REMOVE,
  EVENT_SHOW,
  overlayChannel,
  type ClearPayload,
  type MovePayload,
  type RemovePayload,
  type ShowMediaPayload,
} from "@/lib/realtime";

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

type Item = {
  itemId: string;
  mediaId: string;
  url: string;
  type: MediaType;
  triggeredAt: number;
  x: number;
  y: number;
  scale: number;
  // altura como fracao da tela; nulo = altura natural (mantem a proporcao).
  scaleY: number | null;
  volume: number;
  muted: boolean;
  hidden: boolean;
};

// Pagina "tela em branco" carregada como Browser Source no OBS (secao 2.2).
// Sem UI de controle: so ouve a camada de tempo real e reage. Varios itens
// podem coexistir na tela (sem limite), cada um com sua posicao/tamanho/som.
export default function OverlayPage() {
  const [items, setItems] = useState<Item[]>([]);
  // Qual mesa este overlay mostra: vem de ?mod=<slug> na URL (o painel gera o
  // link certo). Sem mod, mostra so uma ajuda.
  const [mod, setMod] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Elementos de midia (video/audio) por itemId, para aplicar volume/mudo via
  // propriedade do DOM (nao ha prop confiavel de "volume" no React).
  const mediaEls = useRef<Map<string, HTMLMediaElement>>(new Map());
  // Timeouts do modo "flash" (some sozinho) por itemId.
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Ultima atualizacao aplicada por itemId, para descartar eventos fora de ordem.
  const lastAtRef = useRef<Map<string, number>>(new Map());
  // Marca do ultimo evento ao vivo, para o syncState nao sobrescrever algo
  // mais novo que chegou durante o fetch.
  const lastLiveAtRef = useRef(0);

  function clearTimeoutFor(itemId: string) {
    const t = timeoutsRef.current.get(itemId);
    if (t) clearTimeout(t);
    timeoutsRef.current.delete(itemId);
  }

  function removeItem(itemId: string) {
    clearTimeoutFor(itemId);
    lastAtRef.current.delete(itemId);
    setItems((prev) => prev.filter((it) => it.itemId !== itemId));
  }

  function clearAll() {
    for (const t of timeoutsRef.current.values()) clearTimeout(t);
    timeoutsRef.current.clear();
    lastAtRef.current.clear();
    setItems([]);
  }

  // Busca o estado atual no servidor (todos os itens). Chamado ao carregar e a
  // cada reconexao do Pusher, para o overlay recuperar o que esta na tela mesmo
  // tendo perdido eventos ao vivo (Pusher nao repete eventos).
  async function syncState(owner: string) {
    const startedAt = Date.now();
    try {
      const res = await fetch(`/api/overlay/state?mod=${encodeURIComponent(owner)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const { items: rows } = await res.json();
      // Se um evento ao vivo chegou durante o fetch, nao sobrescreve com o
      // estado (possivelmente mais antigo) do banco.
      if (lastLiveAtRef.current > startedAt) return;
      if (!Array.isArray(rows)) return;
      const next: Item[] = rows.map(
        (r: Omit<Item, "triggeredAt"> & { triggeredAt?: number }) => ({
          ...r,
          triggeredAt: startedAt,
        })
      );
      lastAtRef.current.clear();
      for (const it of next) lastAtRef.current.set(it.itemId, startedAt);
      setItems(next);
    } catch {
      // silencioso; o Pusher ainda pode entregar ao vivo.
    }
  }

  // Lê o mod da URL (?mod=<slug>) uma vez, no cliente.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("mod")?.trim() || null;
    setMod(m);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!mod) return;
    syncState(mod);

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY || "", {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
    });

    // Ao (re)conectar, re-sincroniza — cobre quedas de rede do browser source.
    pusher.connection.bind("connected", () => {
      syncState(mod);
    });

    const channelName = overlayChannel(mod);
    const channel = pusher.subscribe(channelName);

    channel.bind(EVENT_SHOW, (payload: ShowMediaPayload) => {
      const itemId = payload.itemId;
      if (!itemId) return;
      lastLiveAtRef.current = Math.max(lastLiveAtRef.current, payload.triggeredAt);
      const prevAt = lastAtRef.current.get(itemId) ?? 0;
      if (payload.triggeredAt < prevAt) return;
      lastAtRef.current.set(itemId, payload.triggeredAt);

      const item: Item = {
        itemId,
        mediaId: payload.mediaId,
        url: payload.url,
        type: payload.type,
        triggeredAt: payload.triggeredAt,
        x: payload.x ?? 0.5,
        y: payload.y ?? 0.5,
        scale: payload.scale ?? 0.3,
        scaleY: typeof payload.scaleY === "number" ? payload.scaleY : null,
        volume: typeof payload.volume === "number" ? payload.volume : 1,
        muted: Boolean(payload.muted),
        hidden: Boolean(payload.hidden),
      };
      setItems((prev) => {
        const rest = prev.filter((it) => it.itemId !== itemId);
        return [...rest, item];
      });

      // flash (nao sticky) some sozinho depois de durationMs.
      clearTimeoutFor(itemId);
      if (!payload.sticky && payload.durationMs > 0) {
        const t = setTimeout(() => removeItem(itemId), payload.durationMs);
        timeoutsRef.current.set(itemId, t);
      }
    });

    channel.bind(EVENT_MOVE, (payload: MovePayload) => {
      const itemId = payload.itemId;
      if (!itemId) return;
      lastLiveAtRef.current = Math.max(lastLiveAtRef.current, payload.triggeredAt);
      const prevAt = lastAtRef.current.get(itemId) ?? 0;
      if (payload.triggeredAt < prevAt) return; // fora de ordem
      lastAtRef.current.set(itemId, payload.triggeredAt);
      setItems((prev) =>
        prev.map((it) =>
          it.itemId === itemId
            ? {
                ...it,
                x: payload.x,
                y: payload.y,
                scale: payload.scale,
                scaleY: typeof payload.scaleY === "number" ? payload.scaleY : null,
                volume: typeof payload.volume === "number" ? payload.volume : it.volume,
                muted: typeof payload.muted === "boolean" ? payload.muted : it.muted,
                hidden: typeof payload.hidden === "boolean" ? payload.hidden : it.hidden,
              }
            : it
        )
      );
    });

    channel.bind(EVENT_REMOVE, (payload: RemovePayload) => {
      lastLiveAtRef.current = Math.max(lastLiveAtRef.current, payload.triggeredAt);
      if (payload.itemId) removeItem(payload.itemId);
    });

    channel.bind(EVENT_CLEAR, (payload: ClearPayload) => {
      lastLiveAtRef.current = Math.max(lastLiveAtRef.current, payload.triggeredAt);
      clearAll();
    });

    return () => {
      pusher.unsubscribe(channelName);
      pusher.disconnect();
      for (const t of timeoutsRef.current.values()) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod]);

  // Aplica volume/mudo a cada elemento de midia sempre que os itens mudarem.
  useEffect(() => {
    for (const it of items) {
      const el = mediaEls.current.get(it.itemId);
      if (!el) continue;
      el.volume = it.volume;
      el.muted = it.muted;
    }
  }, [items]);

  // Sem ?mod= na URL: mostra uma ajuda (so aparece se aberto direto no
  // navegador; no OBS a URL ja vem com o mod).
  if (ready && !mod) {
    return (
      <div className="overlay-root overlay-help">
        <div>
          <p>Este overlay precisa saber de qual mod é a mesa.</p>
          <p>
            Use o link <code>/overlay?mod=SEU_NOME</code> (o painel mostra o link
            certo para colar no OBS).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-root">
      {items.map((it) => {
        // Oculto: nao renderiza (desmonta o elemento -> para o som tambem).
        if (it.hidden) return null;

        if (it.type === "AUDIO") {
          return (
            <audio
              key={it.itemId}
              ref={(el) => {
                if (el) mediaEls.current.set(it.itemId, el);
                else mediaEls.current.delete(it.itemId);
              }}
              src={it.url}
              autoPlay
            />
          );
        }

        const stretched = it.scaleY != null;
        const style: CSSProperties = {
          "--x": it.x,
          "--y": it.y,
          "--s": it.scale,
          ...(stretched ? { "--sy": it.scaleY } : {}),
        } as CSSProperties;

        return (
          <div
            key={it.itemId}
            className={`overlay-movable${stretched ? " stretched" : ""}`}
            style={style}
          >
            {it.type === "VIDEO" ? (
              <video
                ref={(el) => {
                  if (el) mediaEls.current.set(it.itemId, el);
                  else mediaEls.current.delete(it.itemId);
                }}
                className="overlay-media"
                src={it.url}
                autoPlay
                loop
                playsInline
              />
            ) : (
              <img className="overlay-media" src={it.url} alt="" />
            )}
          </div>
        );
      })}
    </div>
  );
}
