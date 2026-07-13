"use client";

import { memo, useEffect, useRef, useState } from "react";
import { buildObsPushUrl, buildObsViewUrl } from "@/lib/vdo";

// Fundo (Twitch/OBS) memoizado: so re-renderiza se a URL mudar. Assim o player
// nao recarrega/pausa quando o resto da mesa re-renderiza.
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

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";

type Media = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  tags: string[];
};

// Um item colocado na mesa. Varios coexistem (sem limite); cada um tem seu
// itemId, posicao, tamanho e som proprios.
type PlacedItem = {
  itemId: string;
  media: Media;
  text?: string; // conteudo quando media.type === "TEXT"
  x: number;
  y: number;
  scaleX: number;
  scaleY: number | null; // null = altura natural (proporcao original)
  volume: number;
  muted: boolean;
  hidden: boolean;
};

const MOVE_THROTTLE_MS = 55;
const MIN_SCALE = 0.005;
const MAX_SCALE = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function genId() {
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const HANDLES = ["tl", "tr", "bl", "br", "t", "b", "l", "r"] as const;
type Handle = (typeof HANDLES)[number];

type ResizeState = {
  itemId: string;
  handle: Handle;
  isCorner: boolean;
  horiz: boolean;
  vert: boolean;
  startX: number;
  startY: number | null;
};

type BgMode = "none" | "twitch" | "obs" | "ref";

export function Mesa({
  media,
  modSlug,
  streamerSlug,
  streamerName,
  onAction,
  vdoRoom,
  vdoPassword,
  twitchChannel,
}: {
  media: Media[];
  modSlug: string;
  streamerSlug: string;
  streamerName: string;
  onAction: () => void;
  vdoRoom: string;
  vdoPassword: string;
  twitchChannel: string;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const dragRef = useRef<{ itemId: string; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  // Elementos de midia da previa (video/audio) por itemId, para aplicar
  // volume/mudo e pausar quando oculto.
  const mediaEls = useRef<Map<string, HTMLMediaElement>>(new Map());
  // Caixas dos itens por itemId, para medir a altura natural ao redimensionar.
  const boxEls = useRef<Map<string, HTMLDivElement>>(new Map());

  const [items, setItems] = useState<PlacedItem[]>([]);
  // Espelho para os handlers de ponteiro lerem o estado atual sem "stale".
  const itemsRef = useRef<PlacedItem[]>([]);
  itemsRef.current = items;

  // Item selecionado (recebe alças/toolbar e os controles de tamanho/som).
  const [selectedId, setSelectedId] = useState<string>("");
  // Midia escolhida no seletor para "Colocar na mesa".
  const [pickId, setPickId] = useState("");
  const [placing, setPlacing] = useState(false);
  // Caixa de texto: o mod digita e "Adicionar texto" coloca no meio da mesa.
  const [textInput, setTextInput] = useState("");

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<BgMode>("none");
  const [twitchCh, setTwitchCh] = useState(twitchChannel);

  useEffect(() => {
    const saved = localStorage.getItem("twitchChannel");
    if (saved) setTwitchCh(saved);
  }, []);

  // Recupera os itens DESTE mod NESTE streamer ao (re)carregar o painel ou ao
  // trocar de streamer — o mod continua de onde parou em vez de ver a mesa
  // vazia. Mesa individual por mod: filtra por owner = o proprio mod.
  useEffect(() => {
    if (!streamerSlug) {
      setItems([]);
      setSelectedId("");
      return;
    }
    let cancelled = false;
    fetch(
      `/api/overlay/state?streamer=${encodeURIComponent(streamerSlug)}&owner=${encodeURIComponent(modSlug)}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.items)) {
          setItems([]);
          return;
        }
        type Row = {
          itemId: string;
          mediaId: string | null;
          url: string | null;
          type: MediaType;
          text?: string | null;
          x: number;
          y: number;
          scale: number;
          scaleY: number | null;
          volume?: number;
          muted?: boolean;
          hidden?: boolean;
        };
        const recovered: PlacedItem[] = (data.items as Row[]).map((row) => {
          const found = row.mediaId ? media.find((m) => m.id === row.mediaId) : undefined;
          const mediaObj: Media = found ?? {
            id: row.mediaId ?? row.itemId,
            name: row.type === "TEXT" ? (row.text ?? "") : (row.mediaId ?? ""),
            type: row.type,
            url: row.url ?? "",
            tags: [],
          };
          return {
            itemId: row.itemId,
            media: mediaObj,
            text: row.text ?? undefined,
            x: row.x,
            y: row.y,
            scaleX: row.scale,
            scaleY: typeof row.scaleY === "number" ? row.scaleY : null,
            volume: typeof row.volume === "number" ? row.volume : 1,
            muted: Boolean(row.muted),
            hidden: Boolean(row.hidden),
          };
        });
        setItems(recovered);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamerSlug, modSlug]);

  // Aplica volume/mudo/oculto aos elementos da previa sempre que os itens mudam.
  useEffect(() => {
    for (const it of items) {
      const el = mediaEls.current.get(it.itemId);
      if (!el) continue;
      el.volume = it.volume;
      el.muted = it.muted;
      if (it.hidden) el.pause();
      else el.play().catch(() => {});
    }
  }, [items]);

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

  const twitchParent = typeof window !== "undefined" ? window.location.hostname : "";
  const twitchSrc = twitchCh
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(
        twitchCh
      )}&parent=${twitchParent}&muted=true&autoplay=true&controls=false`
    : "";

  const selected = items.find((i) => i.itemId === selectedId) ?? null;

  function getItem(itemId: string) {
    return itemsRef.current.find((i) => i.itemId === itemId);
  }

  function patchItem(itemId: string, patch: Partial<PlacedItem>): PlacedItem | null {
    const cur = getItem(itemId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    setItems((prev) => prev.map((p) => (p.itemId === itemId ? next : p)));
    return next;
  }

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

  // Envia posicao/tamanho/som de um item ao overlay. commit = persiste no banco
  // (fim de arrasto/toggle), para recuperar no OBS ao recarregar.
  function pushMove(item: PlacedItem, commit: boolean) {
    const now = Date.now();
    if (!commit && now - lastSentRef.current < MOVE_THROTTLE_MS) return;
    lastSentRef.current = now;
    fetch("/api/trigger/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: item.itemId,
        mediaId: item.media.id,
        streamer: streamerSlug,
        x: item.x,
        y: item.y,
        scale: item.scaleX,
        scaleY: item.scaleY,
        volume: item.volume,
        muted: item.muted,
        hidden: item.hidden,
        commit,
      }),
    }).catch(() => {});
  }

  async function handlePlace() {
    const item = media.find((m) => m.id === pickId);
    if (!item) return;
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    setPlacing(true);
    const itemId = genId();
    // Cascata leve para os itens nao empilharem exatamente no centro.
    const k = items.length % 5;
    const x = clamp(0.3 + k * 0.1, 0.1, 0.9);
    const y = clamp(0.3 + (items.length % 3) * 0.12, 0.1, 0.9);
    const placed: PlacedItem = {
      itemId,
      media: item,
      x,
      y,
      scaleX: 0.3,
      scaleY: null,
      volume: 1,
      muted: false,
      // Entra OCULTO: so aparece no overlay quando o mod clicar em 👁.
      hidden: true,
    };
    try {
      const payload =
        item.type === "AUDIO"
          ? { itemId, mediaId: item.id, streamer: streamerSlug, sticky: true, volume: 1, muted: false, hidden: true }
          : { itemId, mediaId: item.id, streamer: streamerSlug, sticky: true, x, y, scale: 0.3, volume: 1, muted: false, hidden: true };
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao colocar na mesa");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    } finally {
      setPlacing(false);
    }
  }

  async function handleAddText() {
    const content = textInput.trim();
    if (!content) return;
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    const itemId = genId();
    const placed: PlacedItem = {
      itemId,
      media: { id: itemId, name: content.slice(0, 40), type: "TEXT", url: "", tags: [] },
      text: content,
      x: 0.5,
      y: 0.5,
      scaleX: 0.04,
      scaleY: null,
      volume: 1,
      muted: false,
      // Entra OCULTO: so aparece no overlay quando o mod clicar em 👁.
      hidden: true,
    };
    try {
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          streamer: streamerSlug,
          type: "TEXT",
          text: content,
          sticky: true,
          x: 0.5,
          y: 0.5,
          scale: 0.04,
          hidden: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao adicionar texto");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      setTextInput("");
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    }
  }

  async function handleRemoveItem(itemId: string) {
    // Otimista: some da mesa na hora.
    setItems((prev) => prev.filter((p) => p.itemId !== itemId));
    if (selectedId === itemId) setSelectedId("");
    mediaEls.current.delete(itemId);
    boxEls.current.delete(itemId);
    try {
      await fetch("/api/trigger/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, streamer: streamerSlug }),
      });
    } finally {
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

  // --- Arrastar item ---
  function onItemPointerDown(e: React.PointerEvent, item: PlacedItem) {
    setSelectedId(item.itemId);
    const c = coordsFromEvent(e);
    if (!c) return;
    dragRef.current = { itemId: item.itemId, ox: item.x - c.x, oy: item.y - c.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onStagePointerMove(e: React.PointerEvent) {
    if (resizeRef.current) {
      applyResize(e, false);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const c = coordsFromEvent(e);
    if (!c) return;
    const nx = clamp(c.x + d.ox, 0, 1);
    const ny = clamp(c.y + d.oy, 0, 1);
    const next = patchItem(d.itemId, { x: nx, y: ny });
    if (next) pushMove(next, false);
  }

  function onStagePointerUp(e: React.PointerEvent) {
    if (resizeRef.current) {
      applyResize(e, true);
      resizeRef.current = null;
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const it = getItem(d.itemId);
    if (it) pushMove(it, true);
  }

  // Clique no fundo vazio da mesa deseleciona (esconde alças/toolbar).
  function onStagePointerDown(e: React.PointerEvent) {
    if (e.target === stageRef.current) setSelectedId("");
  }

  // --- Redimensionar item selecionado ---
  function onResizeDown(e: React.PointerEvent, item: PlacedItem, handle: Handle) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(item.itemId);
    const isCorner = handle.length === 2;
    const horiz = handle.includes("l") || handle.includes("r");
    const vert = handle.includes("t") || handle.includes("b");

    let startY = item.scaleY;
    // Texto: tamanho uniforme (fonte), sem esticar — nao congela altura.
    // Congela a altura natural para poder ajustar largura/altura livremente.
    if (item.media.type !== "TEXT" && startY == null) {
      const rect = stageRef.current?.getBoundingClientRect();
      const boxH = boxEls.current.get(item.itemId)?.getBoundingClientRect().height;
      if (rect && boxH) {
        startY = clamp(boxH / rect.height, MIN_SCALE, MAX_SCALE);
        patchItem(item.itemId, { scaleY: startY });
      }
    }
    resizeRef.current = {
      itemId: item.itemId,
      handle,
      isCorner,
      horiz,
      vert,
      startX: item.scaleX,
      startY,
    };
  }

  function applyResize(e: React.PointerEvent, commit: boolean) {
    const r = resizeRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!r || !rect) return;
    const it = getItem(r.itemId);
    if (!it) return;
    const cx = rect.left + it.x * rect.width;
    const cy = rect.top + it.y * rect.height;

    let nx = r.startX;
    let ny: number | null = r.startY;

    // Texto: qualquer alça ajusta o tamanho (fonte) de forma uniforme.
    if (it.media.type === "TEXT") {
      const halfW = Math.abs(e.clientX - cx);
      nx = clamp((2 * halfW) / rect.width, MIN_SCALE, MAX_SCALE);
      const nextText = patchItem(r.itemId, { scaleX: nx, scaleY: null });
      if (nextText) pushMove(nextText, commit);
      return;
    }

    if (r.isCorner) {
      const halfW = Math.abs(e.clientX - cx);
      const halfH = Math.abs(e.clientY - cy);
      nx = clamp((2 * halfW) / rect.width, MIN_SCALE, MAX_SCALE);
      ny = clamp((2 * halfH) / rect.height, MIN_SCALE, MAX_SCALE);
    } else if (r.horiz) {
      const halfW = Math.abs(e.clientX - cx);
      nx = clamp((2 * halfW) / rect.width, MIN_SCALE, MAX_SCALE);
      ny = r.startY;
    } else {
      const halfH = Math.abs(e.clientY - cy);
      ny = clamp((2 * halfH) / rect.height, MIN_SCALE, MAX_SCALE);
      nx = r.startX;
    }

    const next = patchItem(r.itemId, { scaleX: nx, scaleY: ny });
    if (next) pushMove(next, commit);
  }

  function onResizeMove(e: React.PointerEvent) {
    if (resizeRef.current) applyResize(e, false);
  }
  function onResizeUp(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    applyResize(e, true);
    resizeRef.current = null;
  }

  // --- Controles de tamanho/som do item selecionado ---
  function onScaleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const newX = Number(e.target.value);
    let next: PlacedItem | null;
    if (selected.scaleY == null) {
      next = patchItem(selected.itemId, { scaleX: newX });
    } else {
      const factor = selected.scaleX > 0 ? newX / selected.scaleX : 1;
      const newY = clamp(selected.scaleY * factor, MIN_SCALE, MAX_SCALE);
      next = patchItem(selected.itemId, { scaleX: newX, scaleY: newY });
    }
    if (next) pushMove(next, false);
  }
  function onScaleCommit() {
    const it = getItem(selectedId);
    if (it) pushMove(it, true);
  }

  function toggleMuted() {
    if (!selected) return;
    const nextMuted = !selected.muted;
    let vol = selected.volume;
    const patch: Partial<PlacedItem> = { muted: nextMuted };
    if (!nextMuted && vol === 0) {
      vol = 1;
      patch.volume = 1;
    }
    const next = patchItem(selected.itemId, patch);
    if (next) pushMove(next, true);
  }

  function onVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const vol = Number(e.target.value);
    const next = patchItem(selected.itemId, { volume: vol, muted: vol === 0 });
    if (next) pushMove(next, false);
  }
  function onVolumeCommit() {
    const it = getItem(selectedId);
    if (it) pushMove(it, true);
  }

  function toggleHidden(item: PlacedItem) {
    const next = patchItem(item.itemId, { hidden: !item.hidden });
    if (next) pushMove(next, true);
  }

  return (
    <section className="panel-section">
      <h2>Mesa ao vivo</h2>
      <p>
        Coloque <strong>quantas mídias quiser</strong> (ou <strong>texto</strong>) — ficam
        juntas na tela. Clique numa para selecionar e <strong>arraste com o mouse</strong>.
        Para redimensionar: <strong>cantos</strong> ajustam largura e altura,{" "}
        <strong>laterais</strong> só a largura, <strong>topo/base</strong> só a altura.
        Os itens entram <strong>ocultos</strong> (aparecem esmaecidos aqui): clique em 👁
        para mostrar no overlay, e ✕ para remover. O OBS acompanha em tempo real.
      </p>

      <div className="mesa-controls">
        <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">Escolha uma mídia…</option>
          {media.map((m) => (
            <option key={m.id} value={m.id}>
              {m.type === "AUDIO" ? "🔊 " : ""}
              {m.name}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={handlePlace}
          disabled={!pickId || placing || !streamerSlug}
        >
          {placing ? "Colocando…" : "Colocar na mesa"}
        </button>
      </div>

      <div className="mesa-controls">
        <input
          placeholder="Texto para a tela…"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddText();
          }}
          style={{ flex: "1 1 240px" }}
        />
        <button
          className="primary"
          onClick={handleAddText}
          disabled={!textInput.trim() || !streamerSlug}
        >
          Adicionar texto
        </button>
      </div>

      {streamerSlug ? (
        <p className="mesa-bg-note">
          Colocando no overlay de <strong>{streamerName || streamerSlug}</strong>.
        </p>
      ) : (
        <p className="mesa-bg-note">
          Escolha um <strong>streamer</strong> na seção acima para começar.
        </p>
      )}

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
        </details>
      )}
      {bgMode === "twitch" && (
        <p className="mesa-bg-note">
          Digite o nome do seu canal acima. Usa a sua transmissão da Twitch como
          fundo — você não precisa abrir nada. Tem alguns segundos de atraso
          (normal da Twitch). Só aparece com a live no ar.
        </p>
      )}

      {selected && selected.media.type !== "AUDIO" && (
        <label className="mesa-scale">
          Tamanho
          <input
            type="range"
            min={MIN_SCALE}
            max={1.5}
            step={MIN_SCALE}
            value={selected.scaleX}
            onChange={onScaleChange}
            onPointerUp={onScaleCommit}
          />
          <span className="mesa-scale-value">
            {selected.scaleX < 0.05
              ? (selected.scaleX * 100).toFixed(1)
              : Math.round(selected.scaleX * 100)}
            %
          </span>
        </label>
      )}

      {selected && (selected.media.type === "VIDEO" || selected.media.type === "AUDIO") && (
        <div className="mesa-audio-row">
          <button
            className="mesa-mute"
            onClick={toggleMuted}
            title={selected.muted ? "Desmutar" : "Mutar"}
            aria-label={selected.muted ? "Desmutar" : "Mutar"}
          >
            {selected.muted ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={selected.muted ? 0 : selected.volume}
            onChange={onVolumeChange}
            onPointerUp={onVolumeCommit}
            aria-label="Volume"
          />
          <span className="mesa-scale-value">
            {Math.round((selected.muted ? 0 : selected.volume) * 100)}%
          </span>
          <span className="mesa-audio-note">som espelhado no OBS</span>
        </div>
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
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
      >
        {bgMode === "obs" && liveConfigured && (
          <StageBg src={buildObsViewUrl(cfg)} title="Tela do OBS ao vivo" />
        )}
        {bgMode === "twitch" && twitchCh && twitchParent && (
          <StageBg src={twitchSrc} title="Transmissão da Twitch" />
        )}

        {items.map((it) => {
          const isSel = it.itemId === selectedId;
          const toolbar = (
            <div className="mesa-item-toolbar" onPointerDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => toggleHidden(it)}
                title={it.hidden ? "Mostrar no overlay" : "Ocultar do overlay"}
                aria-label={it.hidden ? "Mostrar" : "Ocultar"}
              >
                {it.hidden ? "🙈" : "👁"}
              </button>
              <button
                onClick={() => handleRemoveItem(it.itemId)}
                title="Remover da mesa"
                aria-label="Remover"
              >
                ✕
              </button>
            </div>
          );

          if (it.media.type === "AUDIO") {
            return (
              <div
                key={it.itemId}
                className={`mesa-audio-badge${isSel ? " selected" : ""}${it.hidden ? " hidden" : ""}`}
                style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, transform: "translate(-50%, -50%)" }}
                onPointerDown={(e) => onItemPointerDown(e, it)}
              >
                {isSel && toolbar}
                <span className="icon">{it.hidden ? "🙈" : it.muted ? "🔇" : "🔊"}</span>
                <div>
                  {it.hidden ? "Oculto" : "Tocando"} <strong>{it.media.name}</strong>
                </div>
                <audio
                  ref={(el) => {
                    if (el) mediaEls.current.set(it.itemId, el);
                    else mediaEls.current.delete(it.itemId);
                  }}
                  src={it.media.url}
                  autoPlay
                />
              </div>
            );
          }

          if (it.media.type === "TEXT") {
            return (
              <div
                key={it.itemId}
                ref={(el) => {
                  if (el) boxEls.current.set(it.itemId, el);
                  else boxEls.current.delete(it.itemId);
                }}
                className={`mesa-item text-item${isSel ? " selected" : ""}${it.hidden ? " hidden" : ""}`}
                style={
                  {
                    left: `${it.x * 100}%`,
                    top: `${it.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    "--s": it.scaleX,
                  } as React.CSSProperties
                }
                onPointerDown={(e) => onItemPointerDown(e, it)}
              >
                {isSel && toolbar}
                <span className="mesa-text">{it.text}</span>
                {isSel &&
                  HANDLES.map((h) => (
                    <span
                      key={h}
                      className={`mesa-handle ${h}`}
                      onPointerDown={(e) => onResizeDown(e, it, h)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                    />
                  ))}
              </div>
            );
          }

          return (
            <div
              key={it.itemId}
              ref={(el) => {
                if (el) boxEls.current.set(it.itemId, el);
                else boxEls.current.delete(it.itemId);
              }}
              className={`mesa-item${it.scaleY != null ? " stretched" : ""}${isSel ? " selected" : ""}${it.hidden ? " hidden" : ""}`}
              style={{
                left: `${it.x * 100}%`,
                top: `${it.y * 100}%`,
                width: `${it.scaleX * 100}%`,
                ...(it.scaleY != null ? { height: `${it.scaleY * 100}%` } : {}),
                transform: `translate(-50%, -50%)`,
              }}
              onPointerDown={(e) => onItemPointerDown(e, it)}
            >
              {isSel && toolbar}
              {it.media.type === "VIDEO" ? (
                <video
                  ref={(el) => {
                    if (el) mediaEls.current.set(it.itemId, el);
                    else mediaEls.current.delete(it.itemId);
                  }}
                  src={it.media.url}
                  loop
                  autoPlay
                  playsInline
                  draggable={false}
                />
              ) : (
                <img src={it.media.url} alt={it.media.name} draggable={false} />
              )}
              {isSel &&
                HANDLES.map((h) => (
                  <span
                    key={h}
                    className={`mesa-handle ${h}`}
                    onPointerDown={(e) => onResizeDown(e, it, h)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                  />
                ))}
            </div>
          );
        })}

        {items.length === 0 && bgMode === "none" && (
          <span className="mesa-hint">Coloque uma ou mais mídias e arraste aqui</span>
        )}
      </div>
    </section>
  );
}
