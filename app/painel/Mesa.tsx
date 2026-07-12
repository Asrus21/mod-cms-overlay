"use client";

import { useRef, useState } from "react";

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

type Media = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  tags: string[];
};

// Intervalo minimo entre updates de posicao enviados ao servidor enquanto
// arrasta (throttle). ~55ms ≈ 18 updates/seg — suave sem inundar o Pusher.
const MOVE_THROTTLE_MS = 55;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// "Mesa ao vivo": o mod escolhe uma midia, ela vai para o overlay do OBS e
// fica fixa (sticky). Arrastando com o mouse aqui na previa, a posicao e
// espelhada em tempo real no overlay (evento media:move). A escala tem um
// controle deslizante. Audio nao entra na mesa (nao tem posicao visual).
export function Mesa({ media, onAction }: { media: Media[]; onAction: () => void }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const draggingRef = useRef(false);

  const [selectedId, setSelectedId] = useState("");
  const [placed, setPlaced] = useState<Media | null>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [scale, setScale] = useState(1);
  const [placing, setPlacing] = useState(false);

  const placeable = media.filter((m) => m.type !== "AUDIO");

  function sendMove(x: number, y: number, s: number, force = false) {
    if (!placed) return;
    const now = Date.now();
    if (!force && now - lastSentRef.current < MOVE_THROTTLE_MS) return;
    lastSentRef.current = now;
    // fire-and-forget: nao bloqueia o arrasto esperando a resposta.
    fetch("/api/trigger/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: placed.id, x, y, scale: s }),
    }).catch(() => {});
  }

  async function handlePlace() {
    const item = placeable.find((m) => m.id === selectedId);
    if (!item) return;
    setPlacing(true);
    try {
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: item.id, sticky: true, x: 0.5, y: 0.5, scale }),
      });
      if (!res.ok) throw new Error("Falha ao colocar na mesa");
      setPlaced(item);
      setPos({ x: 0.5, y: 0.5 });
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    } finally {
      setPlacing(false);
    }
  }

  async function handleRemove() {
    try {
      await fetch("/api/trigger/clear", { method: "POST" });
    } finally {
      setPlaced(null);
      onAction();
    }
  }

  function coordsFromEvent(e: React.PointerEvent) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!placed) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scale, true);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scale);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scale, true); // garante a posicao final
    }
  }

  function onScaleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const s = Number(e.target.value);
    setScale(s);
    sendMove(pos.x, pos.y, s, true);
  }

  return (
    <section className="panel-section">
      <h2>Mesa ao vivo</h2>
      <p>
        Coloque uma imagem/gif/vídeo na tela e <strong>arraste com o mouse</strong>{" "}
        aqui embaixo — o overlay do OBS acompanha o movimento em tempo real.
      </p>

      <div className="mesa-controls">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">Escolha uma mídia…</option>
          {placeable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={handlePlace} disabled={!selectedId || placing}>
          {placing ? "Colocando…" : "Colocar na mesa"}
        </button>
        {placed && (
          <button className="danger" onClick={handleRemove}>
            Tirar da mesa
          </button>
        )}
      </div>

      {placed && (
        <label className="mesa-scale">
          Tamanho
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.05}
            value={scale}
            onChange={onScaleChange}
          />
        </label>
      )}

      <div
        ref={stageRef}
        className="mesa-stage"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {placed ? (
          <div
            className="mesa-item"
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
            onPointerDown={onPointerDown}
          >
            {placed.type === "VIDEO" ? (
              <video src={placed.url} muted loop autoPlay draggable={false} />
            ) : (
              <img src={placed.url} alt={placed.name} draggable={false} />
            )}
          </div>
        ) : (
          <span className="mesa-hint">A prévia da tela aparece aqui</span>
        )}
      </div>
    </section>
  );
}
