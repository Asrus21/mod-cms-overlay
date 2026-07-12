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
type BgMode = "none" | "twitch" | "obs" | "ref";

export function Mesa({
  media,
  onAction,
  vdoRoom,
  vdoPassword,
  twitchChannel,
}: {
  media: Media[];
  onAction: () => void;
  vdoRoom: string;
  vdoPassword: string;
  twitchChannel: string;
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
  // Modo do fundo da mesa (guia visual para posicionar):
  //  - twitch: a propria transmissao da Twitch (nao exige abrir nada; ~seg de atraso)
  //  - obs: a Camera Virtual do OBS via VDO.Ninja (tempo real; precisa transmitir)
  //  - ref: um print estatico carregado localmente
  const [bgMode, setBgMode] = useState<BgMode>("none");

  const liveConfigured = Boolean(vdoRoom);
  const twitchConfigured = Boolean(twitchChannel);
  const cfg = { room: vdoRoom, password: vdoPassword };

  // parent exigido pelo player da Twitch = dominio que hospeda o embed.
  const twitchParent = typeof window !== "undefined" ? window.location.hostname : "";
  const twitchSrc = twitchConfigured
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(
        twitchChannel
      )}&parent=${twitchParent}&muted=true&autoplay=true&controls=false`
    : "";

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

      <div className="mesa-bg-row">
        <label className="mesa-bg-label">
          Fundo da mesa (guia para posicionar)
          <select value={bgMode} onChange={(e) => setBgMode(e.target.value as BgMode)}>
            <option value="none">Nenhum</option>
            {twitchConfigured && (
              <option value="twitch">Transmissão da Twitch (não precisa abrir nada)</option>
            )}
            {liveConfigured && <option value="obs">Tela do OBS ao vivo (VDO.Ninja)</option>}
            <option value="ref">Imagem de referência (print)</option>
          </select>
        </label>

        {bgMode === "obs" && liveConfigured && (
          <button onClick={() => window.open(buildObsPushUrl(cfg), "_blank", "noopener")}>
            📺 Transmitir a tela do OBS
          </button>
        )}
        {bgMode === "ref" && (
          <>
            <input type="file" accept="image/*" onChange={onPickBackground} />
            {bgUrl && <button onClick={clearBackground}>Remover</button>}
          </>
        )}
      </div>

      {bgMode === "obs" && liveConfigured && (
        <details className="obs-help">
          <summary>Como transmitir a tela do OBS (streamer, uma vez)</summary>
          <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            <li>No OBS, clique em <strong>Iniciar câmera virtual</strong>.</li>
            <li>Clique em <strong>Transmitir a tela do OBS</strong> acima.</li>
            <li>
              Na aba do VDO.Ninja, escolha a câmera <strong>OBS Virtual Camera</strong> e
              deixe a aba aberta.
            </li>
          </ol>
        </details>
      )}
      {bgMode === "twitch" && twitchConfigured && (
        <p className="mesa-bg-note">
          Usa a sua transmissão da Twitch como fundo — você não precisa abrir nada.
          Tem alguns segundos de atraso (normal da Twitch), o que não atrapalha para
          posicionar.
        </p>
      )}

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
          bgMode === "ref" && bgUrl
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
        {bgMode === "obs" && liveConfigured && (
          <iframe
            className="mesa-live-bg"
            src={buildObsViewUrl(cfg)}
            allow="autoplay; fullscreen"
            title="Tela do OBS ao vivo"
          />
        )}
        {bgMode === "twitch" && twitchConfigured && twitchParent && (
          <iframe
            className="mesa-live-bg"
            src={twitchSrc}
            allow="autoplay; fullscreen"
            title="Transmissão da Twitch"
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
