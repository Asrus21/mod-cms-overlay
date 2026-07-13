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

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";

type Item = {
  itemId: string;
  owner: string;
  mediaId: string;
  url: string;
  type: MediaType;
  text: string;
  triggeredAt: number;
  x: number;
  y: number;
  scale: number;
  scaleY: number | null;
  volume: number;
  muted: boolean;
  hidden: boolean;
};

// Overlay de UM streamer (Browser Source no OBS). Varios mods publicam nele;
// mostra todos os itens de todos os mods daquele streamer. Sem UI: so ouve a
// camada de tempo real e reage.
export function OverlayView({ streamer }: { streamer: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const mediaEls = useRef<Map<string, HTMLMediaElement>>(new Map());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastAtRef = useRef<Map<string, number>>(new Map());
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

  // Limpa itens de um mod (owner) — ou todos, se owner ausente.
  function clearOwner(owner?: string) {
    setItems((prev) => {
      const keep = owner ? prev.filter((it) => it.owner !== owner) : [];
      const removed = owner ? prev.filter((it) => it.owner === owner) : prev;
      for (const it of removed) clearTimeoutFor(it.itemId);
      for (const it of removed) lastAtRef.current.delete(it.itemId);
      return keep;
    });
  }

  async function syncState() {
    const startedAt = Date.now();
    try {
      const res = await fetch(
        `/api/overlay/state?streamer=${encodeURIComponent(streamer)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const { items: rows } = await res.json();
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

  useEffect(() => {
    if (!streamer) return;
    syncState();

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY || "", {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
    });

    pusher.connection.bind("connected", () => {
      syncState();
    });

    const channelName = overlayChannel(streamer);
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
        owner: payload.owner || "",
        mediaId: payload.mediaId,
        url: payload.url,
        type: payload.type,
        text: payload.text || "",
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
      if (payload.triggeredAt < prevAt) return;
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
      clearOwner(payload.owner);
    });

    return () => {
      pusher.unsubscribe(channelName);
      pusher.disconnect();
      for (const t of timeoutsRef.current.values()) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamer]);

  useEffect(() => {
    for (const it of items) {
      const el = mediaEls.current.get(it.itemId);
      if (!el) continue;
      el.volume = it.volume;
      el.muted = it.muted;
    }
  }, [items]);

  return (
    <div className="overlay-root">
      {items.map((it) => {
        if (it.hidden) return null;

        if (it.type === "TEXT") {
          const style = {
            "--x": it.x,
            "--y": it.y,
            "--s": it.scale,
          } as CSSProperties;
          return (
            <div key={it.itemId} className="overlay-movable text-item" style={style}>
              <span className="overlay-text">{it.text}</span>
            </div>
          );
        }

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
