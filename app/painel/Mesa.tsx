"use client";

import { useRef, useState } from "react";
import { buildObsPushUrl, buildObsViewUrl } from "@/lib/vdo";

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
export function Mesa({
  media,
  onAction,
  vdoRoom,
  vdoPassword,
}: {
  media: Media[];
  onAction: () => void;
  vdoRoom: string;
  vdoPassword: string;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const draggingRef = useRef(false);

  const [selectedId, setSelectedId] = useState("");
  const [placed, setPlaced] = useState<Media | null>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  // scale = tamanho como FRACAO da largura da tela (0.05..1.5). Mesma
  // proporcao vale na previa e no OBS (WYSIWYG).
  const [scale, setScale] = useState(0.3);
  const [placing, setPlacing] = useState(false);
  // Fundo de referencia: um print da cena do OBS carregado localmente, so
  // como guia visual para posicionar (nao vai para o overlay/servidor).
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  // Fundo AO VIVO: embute a tela do OBS (transmitida pela Camera Virtual via
  // VDO.Ninja) atras da mesa, para posicionar sobre a cena real em tempo real.
  const [liveBg, setLiveBg] = useState(false);

  const liveConfigured = Boolean(vdoRoom);
  const cfg = { room: vdoRoom, password: vdoPassword };

  const placeable = media.filter((m) => m.type !== "AUDIO");

  function onPickBackground(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(URL.createObjectURL(file));
  }

  function clearBackground() {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(null);
  }

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao colocar na mesa");
      }
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

      {liveConfigured && (
        <div className="mesa-bg-row">
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={liveBg}
              onChange={(e) => setLiveBg(e.target.checked)}
            />
            Ver a tela do OBS ao vivo (fundo)
          </label>
          <button onClick={() => window.open(buildObsPushUrl(cfg), "_blank", "noopener")}>
            📺 Transmitir a tela do OBS
          </button>
          <details className="obs-help">
            <summary>Como transmitir a tela do OBS (streamer, uma vez)</summary>
            <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
              <li>No OBS, clique em <strong>Iniciar câmera virtual</strong>.</li>
              <li>
                Clique em <strong>Transmitir a tela do OBS</strong> acima: abre uma
                aba do VDO.Ninja.
              </li>
              <li>
                Nessa aba, escolha a câmera <strong>OBS Virtual Camera</strong> e
                deixe a aba aberta.
              </li>
              <li>Marque <strong>Ver a tela do OBS ao vivo</strong> aqui.</li>
            </ol>
          </details>
        </div>
      )}

      <div className="mesa-bg-row">
        <label className="mesa-bg-label">
          Fundo de referência (print da cena)
          <input type="file" accept="image/*" onChange={onPickBackground} />
        </label>
        {bgUrl && <button onClick={clearBackground}>Remover fundo</button>}
      </div>

      {placed && (
        <label className="mesa-scale">
          Tamanho
          <input
            type="range"
            min={0.05}
            max={1.5}
            step={0.01}
            value={scale}
            onChange={onScaleChange}
          />
          <span className="mesa-scale-value">{Math.round(scale * 100)}%</span>
        </label>
      )}

      <div
        ref={stageRef}
        className="mesa-stage"
        style={
          bgUrl
            ? {
                backgroundImage: `url(${bgUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {liveBg && liveConfigured && (
          <iframe
            className="mesa-live-bg"
            src={buildObsViewUrl(cfg)}
            allow="autoplay; fullscreen"
            title="Tela do OBS ao vivo"
          />
        )}
        {placed ? (
          <div
            className="mesa-item"
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${scale * 100}%`,
              transform: `translate(-50%, -50%)`,
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
