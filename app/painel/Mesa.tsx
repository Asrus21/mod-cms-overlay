"use client";

import { memo, useEffect, useRef, useState } from "react";
import { buildObsPushUrl, buildObsViewUrl } from "@/lib/vdo";

// Fundo (Twitch/OBS) memoizado: so re-renderiza se a URL mudar. Assim o player
// nao recarrega/pausa quando o resto da mesa re-renderiza (colocar/arrastar
// midia dispara muitos re-renders).
const StageBg = memo(function StageBg({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      className="mesa-live-bg"
      src={src}
      allow="autoplay; fullscreen"
      title={title}
    />
  );
});

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

// Limites do tamanho (fracao da tela). 0.005 = quase sumindo; 3 = 3x a tela.
const MIN_SCALE = 0.005;
const MAX_SCALE = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// Alças de redimensionamento (estilo OBS): 4 cantos (proporcional) + 4 laterais
// (largura OU altura). Ids de 2 letras = canto; de 1 letra = lateral.
const HANDLES = ["tl", "tr", "bl", "br", "t", "b", "l", "r"] as const;
type Handle = (typeof HANDLES)[number];

type ResizeState = {
  handle: Handle;
  isCorner: boolean;
  horiz: boolean;
  vert: boolean;
  startX: number;
  startY: number | null;
};

// "Mesa ao vivo": o mod escolhe uma midia, ela vai para o overlay do OBS e
// fica fixa (sticky). Arrastando com o mouse aqui na previa, a posicao e
// espelhada em tempo real no overlay (evento media:move). O tamanho tem um
// slider e alças nos cantos/laterais. Audio nao tem posicao/tamanho: e apenas
// tocado no overlay (indicador na mesa).
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
  const itemRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSentRef = useRef(0);
  const draggingRef = useRef(false);
  const resizeRef = useRef<ResizeState | null>(null);

  const [selectedId, setSelectedId] = useState("");
  const [placed, setPlaced] = useState<Media | null>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  // scaleX = largura (fracao da largura da tela). scaleY = altura (fracao da
  // altura da tela); null = altura natural (mantem a proporcao, sem distorcer).
  const [scaleX, setScaleX] = useState(0.3);
  const [scaleY, setScaleY] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  // Previa do video: comeca MUDA (o navegador so deixa dar autoplay se estiver
  // muda, e evita estourar o audio no ouvido do mod ao posicionar). O botao
  // 🔊 desmuta — o som "de verdade" toca no overlay do OBS.
  const [previewMuted, setPreviewMuted] = useState(true);
  // Fundo de referencia: um print da cena do OBS carregado localmente, so
  // como guia visual para posicionar (nao vai para o overlay/servidor).
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  // Modo do fundo da mesa (guia visual para posicionar):
  //  - twitch: a propria transmissao da Twitch (nao exige abrir nada; ~seg de atraso)
  //  - obs: a Camera Virtual do OBS via VDO.Ninja (tempo real; precisa transmitir)
  //  - ref: um print estatico carregado localmente
  const [bgMode, setBgMode] = useState<BgMode>("none");
  // Canal da Twitch: comeca com o valor do servidor (se houver) e pode ser
  // digitado/editado aqui (nome de canal e publico), salvo no navegador.
  const [twitchCh, setTwitchCh] = useState(twitchChannel);

  useEffect(() => {
    const saved = localStorage.getItem("twitchChannel");
    if (saved) setTwitchCh(saved);
  }, []);

  function onTwitchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.trim();
    setTwitchCh(v);
    localStorage.setItem("twitchChannel", v);
  }

  async function copyObsUrl() {
    const url = buildObsPushUrl({ room: vdoRoom, password: vdoPassword });
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado! Cole num Dock de navegador no OBS (Exibir → Docks).");
    } catch {
      alert(url);
    }
  }

  const liveConfigured = Boolean(vdoRoom);
  const cfg = { room: vdoRoom, password: vdoPassword };

  // parent exigido pelo player da Twitch = dominio que hospeda o embed.
  const twitchParent = typeof window !== "undefined" ? window.location.hostname : "";
  const twitchSrc = twitchCh
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(
        twitchCh
      )}&parent=${twitchParent}&muted=true&autoplay=true&controls=false`
    : "";

  // Todos os tipos podem ir para a mesa. Audio nao tem posicao/tamanho: e so
  // tocado no overlay (mostramos um indicador aqui).
  const items = media;
  const isAudio = placed?.type === "AUDIO";

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

  // Envia posicao/tamanho ao servidor (repassado ao overlay). sy = null =>
  // altura natural. Audio nao envia (nao tem posicao).
  function sendMove(x: number, y: number, sx: number, sy: number | null, force = false) {
    if (!placed || placed.type === "AUDIO") return;
    const now = Date.now();
    if (!force && now - lastSentRef.current < MOVE_THROTTLE_MS) return;
    lastSentRef.current = now;
    // fire-and-forget: nao bloqueia o arrasto esperando a resposta.
    fetch("/api/trigger/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: placed.id, x, y, scale: sx, scaleY: sy }),
    }).catch(() => {});
  }

  async function handlePlace() {
    const item = items.find((m) => m.id === selectedId);
    if (!item) return;
    setPlacing(true);
    try {
      // Audio: so toca (sticky), sem posicao/tamanho. Visual: comeca no centro
      // com altura natural (scaleY ausente).
      const payload =
        item.type === "AUDIO"
          ? { mediaId: item.id, sticky: true }
          : { mediaId: item.id, sticky: true, x: 0.5, y: 0.5, scale: scaleX };
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao colocar na mesa");
      }
      setPlaced(item);
      setPos({ x: 0.5, y: 0.5 });
      setScaleY(null); // volta para altura natural ao colocar nova midia
      setPreviewMuted(true); // previa sempre comeca muda
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
    if (!placed || isAudio) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scaleX, scaleY, true);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scaleX, scaleY);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const c = coordsFromEvent(e);
    if (c) {
      setPos(c);
      sendMove(c.x, c.y, scaleX, scaleY, true); // garante a posicao final
    }
  }

  function onScaleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newX = Number(e.target.value);
    setScaleX(newX);
    if (scaleY == null) {
      sendMove(pos.x, pos.y, newX, null, true);
    } else {
      // mantem a proporcao atual: escala a altura pelo mesmo fator.
      const factor = scaleX > 0 ? newX / scaleX : 1;
      const newY = clamp(scaleY * factor, MIN_SCALE, MAX_SCALE);
      setScaleY(newY);
      sendMove(pos.x, pos.y, newX, newY, true);
    }
  }

  // --- Redimensionamento por alças (cantos = proporcional; laterais = 1 eixo) ---
  function onResizeDown(e: React.PointerEvent, handle: Handle) {
    e.stopPropagation(); // nao inicia o arrasto de mover
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const isCorner = handle.length === 2;
    const horiz = handle.includes("l") || handle.includes("r");
    const vert = handle.includes("t") || handle.includes("b");

    let startY = scaleY;
    // Para esticar so um eixo a partir do estado "natural", congelamos a altura
    // atual — senao mudar a largura mudaria a altura junto (proporcao travada).
    if (startY == null && !isCorner) {
      const rect = stageRef.current?.getBoundingClientRect();
      const itemH = itemRef.current?.getBoundingClientRect().height;
      if (rect && itemH) {
        startY = clamp(itemH / rect.height, MIN_SCALE, MAX_SCALE);
        setScaleY(startY);
      }
    }
    resizeRef.current = { handle, isCorner, horiz, vert, startX: scaleX, startY };
  }

  function applyResize(e: React.PointerEvent, force: boolean) {
    const r = resizeRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!r || !rect) return;
    const cx = rect.left + pos.x * rect.width;
    const cy = rect.top + pos.y * rect.height;

    let nx = r.startX;
    let ny: number | null = r.startY;

    if (r.isCorner) {
      // proporcional: usa a distancia horizontal para a largura e escala a
      // altura pelo mesmo fator (mantem a proporcao atual da midia).
      const halfW = Math.abs(e.clientX - cx);
      nx = clamp((2 * halfW) / rect.width, MIN_SCALE, MAX_SCALE);
      if (r.startY != null) {
        const factor = r.startX > 0 ? nx / r.startX : 1;
        ny = clamp(r.startY * factor, MIN_SCALE, MAX_SCALE);
      } else {
        ny = null; // segue com altura natural
      }
    } else if (r.horiz) {
      // lateral esquerda/direita: so a largura.
      const halfW = Math.abs(e.clientX - cx);
      nx = clamp((2 * halfW) / rect.width, MIN_SCALE, MAX_SCALE);
      ny = r.startY; // altura congelada no down
    } else {
      // topo/base: so a altura.
      const halfH = Math.abs(e.clientY - cy);
      ny = clamp((2 * halfH) / rect.height, MIN_SCALE, MAX_SCALE);
      nx = r.startX;
    }

    setScaleX(nx);
    setScaleY(ny);
    sendMove(pos.x, pos.y, nx, ny, force);
  }

  function onResizeMove(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    applyResize(e, false);
  }

  function onResizeUp(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    applyResize(e, true);
    resizeRef.current = null;
  }

  // Liga/desliga o som da PREVIA (o som "de verdade" toca no overlay do OBS).
  // Desmutar exige um clique (gesto do usuario) — por isso e um botao.
  function togglePreviewMute() {
    setPreviewMuted((m) => {
      const next = !m;
      const v = videoRef.current;
      if (v) {
        v.muted = next;
        if (!next) v.play().catch(() => {});
      }
      return next;
    });
  }

  // Tamanho mostrado (largura). Uma casa decimal quando muito pequeno.
  const sizeLabel = scaleX < 0.05 ? (scaleX * 100).toFixed(1) : Math.round(scaleX * 100);

  return (
    <section className="panel-section">
      <h2>Mesa ao vivo</h2>
      <p>
        Coloque uma imagem/gif/vídeo/áudio e <strong>arraste com o mouse</strong> aqui
        embaixo. Para redimensionar: <strong>cantos</strong> mantêm a proporção,{" "}
        <strong>laterais</strong> mudam só a largura e <strong>topo/base</strong> só a
        altura (ou use o slider). O overlay do OBS acompanha em tempo real.
      </p>

      <div className="mesa-controls">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">Escolha uma mídia…</option>
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.type === "AUDIO" ? "🔊 " : ""}
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
            <option value="twitch">Transmissão da Twitch (não precisa abrir nada)</option>
            {liveConfigured && <option value="obs">Tela do OBS ao vivo (VDO.Ninja)</option>}
            <option value="ref">Imagem de referência (print)</option>
          </select>
        </label>

        {bgMode === "twitch" && (
          <label className="mesa-bg-label">
            Canal da Twitch
            <input value={twitchCh} onChange={onTwitchChange} placeholder="seu_canal" />
          </label>
        )}
        {bgMode === "obs" && liveConfigured && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={copyObsUrl}>📋 Copiar link (para o Dock do OBS)</button>
            <button onClick={() => window.open(buildObsPushUrl(cfg), "_blank", "noopener")}>
              Abrir em aba
            </button>
          </div>
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
          <summary>Como ter a tela do OBS ao vivo (tempo real, dentro do OBS)</summary>
          <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            <li>No OBS, clique em <strong>Iniciar câmera virtual</strong>.</li>
            <li>Clique em <strong>Copiar link</strong> acima.</li>
            <li>
              No OBS: <strong>Exibir → Docks → Docks de navegador personalizados</strong>,
              cole o link, dê um nome e <strong>Aplicar</strong>.
            </li>
            <li>
              No dock que aparecer dentro do OBS, escolha a câmera{" "}
              <strong>OBS Virtual Camera</strong> (uma vez).
            </li>
            <li>
              Pronto: enquanto o OBS estiver aberto, a tela aparece aqui em{" "}
              <strong>tempo real</strong> — sem aba de navegador aberta.
            </li>
          </ol>
          <p style={{ margin: "0.5rem 0 0", color: "#9aa2b1" }}>
            Alternativa: use <strong>Abrir em aba</strong> (uma janela de navegador
            comum, que precisa ficar aberta).
          </p>
        </details>
      )}
      {bgMode === "twitch" && (
        <p className="mesa-bg-note">
          Digite o nome do seu canal acima. Usa a sua transmissão da Twitch como
          fundo — você não precisa abrir nada. Tem alguns segundos de atraso
          (normal da Twitch), o que não atrapalha para posicionar. Só aparece com a
          live no ar.
        </p>
      )}

      {placed && !isAudio && (
        <label className="mesa-scale">
          Tamanho
          <input
            type="range"
            min={MIN_SCALE}
            max={1.5}
            step={MIN_SCALE}
            value={scaleX}
            onChange={onScaleChange}
          />
          <span className="mesa-scale-value">{sizeLabel}%</span>
        </label>
      )}

      {placed?.type === "VIDEO" && (
        <p className="mesa-bg-note" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button onClick={togglePreviewMute}>
            {previewMuted ? "🔊 Ouvir o som aqui" : "🔇 Silenciar prévia"}
          </button>
          <span>
            A prévia começa muda; o som do vídeo toca no overlay do OBS (não aqui).
          </span>
        </p>
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
          <StageBg src={buildObsViewUrl(cfg)} title="Tela do OBS ao vivo" />
        )}
        {bgMode === "twitch" && twitchCh && twitchParent && (
          <StageBg src={twitchSrc} title="Transmissão da Twitch" />
        )}
        {placed ? (
          isAudio ? (
            <div className="mesa-audio-badge">
              <span className="icon">🔊</span>
              <div>
                Tocando <strong>{placed.name}</strong> no overlay
              </div>
              <audio src={placed.url} controls autoPlay />
            </div>
          ) : (
            <div
              ref={itemRef}
              className={`mesa-item${scaleY != null ? " stretched" : ""}`}
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                width: `${scaleX * 100}%`,
                ...(scaleY != null ? { height: `${scaleY * 100}%` } : {}),
                transform: `translate(-50%, -50%)`,
              }}
              onPointerDown={onPointerDown}
            >
              {placed.type === "VIDEO" ? (
                <video
                  ref={videoRef}
                  src={placed.url}
                  muted={previewMuted}
                  loop
                  autoPlay
                  playsInline
                  draggable={false}
                />
              ) : (
                <img src={placed.url} alt={placed.name} draggable={false} />
              )}
              {HANDLES.map((h) => (
                <span
                  key={h}
                  className={`mesa-handle ${h}`}
                  onPointerDown={(e) => onResizeDown(e, h)}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeUp}
                />
              ))}
            </div>
          )
        ) : (
          bgMode === "none" && (
            <span className="mesa-hint">Coloque uma mídia e arraste aqui</span>
          )
        )}
      </div>
    </section>
  );
}
