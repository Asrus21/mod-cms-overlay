"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Pusher from "pusher-js";
import { streamerSlug } from "@/lib/slug";
import { buildPushUrl, buildSceneUrl, streamIdFromName } from "@/lib/vdo";
import { Mesa } from "./Mesa";
import { Diagnostico } from "./Diagnostico";

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

type Media = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  tags: string[];
};

type AuditEntry = {
  id: string;
  action: "SHOW" | "CLEAR" | "UPLOAD" | "LIVE";
  actor: string;
  mediaName: string | null;
  createdAt: string;
};

const DEFAULT_DURATION_MS = 5000;

const TYPE_LABEL: Record<MediaType, string> = {
  IMAGE: "Imagem",
  GIF: "Gif",
  VIDEO: "Video",
  AUDIO: "Audio",
};

export function PainelClient({
  modName,
  modSlug,
  vdoRoom,
  vdoPassword,
  twitchChannel,
}: {
  modName: string;
  modSlug: string;
  vdoRoom: string;
  vdoPassword: string;
  twitchChannel: string;
}) {
  const router = useRouter();
  // Streamer alvo: o overlay e por streamer (compartilhado). O mod escolhe/
  // pesquisa o streamer; tudo o que ele colocar vai para o overlay desse
  // streamer. Guardado no navegador (nome + slug) e a lista de recentes para
  // sugestoes na busca.
  const [streamer, setStreamer] = useState<{ slug: string; name: string } | null>(null);
  const [recentStreamers, setRecentStreamers] = useState<{ slug: string; name: string }[]>([]);
  const [streamerQuery, setStreamerQuery] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const s = JSON.parse(localStorage.getItem("streamers") || "[]");
      if (Array.isArray(s)) setRecentStreamers(s);
      const last = JSON.parse(localStorage.getItem("streamerAtual") || "null");
      if (last && last.slug) setStreamer(last);
    } catch {
      // ignora
    }
  }, []);

  const overlayUrl = streamer ? `${origin}/overlay/${streamer.slug}` : "";

  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [media, setMedia] = useState<Media[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [autoShow, setAutoShow] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  // Status da conexao em tempo real (secao 2.1 / 7): o mod precisa saber se
  // esta de fato conectado antes de tentar disparar algo.
  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY || "", {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2",
    });

    pusher.connection.bind("state_change", (states: { current: string }) => {
      if (states.current === "connected") setConnectionState("connected");
      else if (states.current === "connecting") setConnectionState("connecting");
      else setConnectionState("disconnected");
    });

    return () => {
      pusher.disconnect();
    };
  }, []);

  // Seleciona/gera o streamer alvo (a partir do nome pesquisado). O slug e
  // deterministico, entao o link do overlay nunca muda para o mesmo nome.
  function selectStreamer(name: string) {
    const trimmed = name.trim();
    const slug = streamerSlug(trimmed);
    if (!slug) return;
    const entry = { slug, name: trimmed };
    setStreamer(entry);
    localStorage.setItem("streamerAtual", JSON.stringify(entry));
    setRecentStreamers((prev) => {
      const next = [entry, ...prev.filter((s) => s.slug !== slug)].slice(0, 12);
      localStorage.setItem("streamers", JSON.stringify(next));
      return next;
    });
  }

  function forgetStreamer(slug: string) {
    setRecentStreamers((prev) => {
      const next = prev.filter((s) => s.slug !== slug);
      localStorage.setItem("streamers", JSON.stringify(next));
      return next;
    });
    if (streamer?.slug === slug) {
      setStreamer(null);
      localStorage.removeItem("streamerAtual");
    }
  }

  async function loadMedia() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (typeFilter) params.set("type", typeFilter);
    const res = await fetch(`/api/media?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setMedia(data.media);
    }
  }

  async function loadHistory() {
    const res = await fetch("/api/audit");
    if (res.ok) {
      const data = await res.json();
      setHistory(data.entries);
    }
  }

  useEffect(() => {
    loadMedia();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, typeFilter]);

  async function triggerShow(mediaId: string) {
    if (!streamer) throw new Error("Escolha um streamer primeiro (campo Streamer).");
    const res = await fetch("/api/trigger/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId, streamer: streamer.slug, durationMs: DEFAULT_DURATION_MS }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Falha ao disparar midia");
    }
  }

  // Ao escolher o arquivo, ja detecta o tipo (imagem/gif/video/audio) pelo
  // MIME. Assim o mod nao esquece de trocar o seletor (motivo comum de "nao
  // aparece o video" / "nao toca o audio": foi cadastrado como Imagem).
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const form = e.target.form;
    if (!file || !form) return;
    const typeSel = form.elements.namedItem("type") as HTMLSelectElement | null;
    const nameInput = form.elements.namedItem("name") as HTMLInputElement | null;
    const mime = file.type;
    let detected: MediaType = "IMAGE";
    if (mime.startsWith("video/")) detected = "VIDEO";
    else if (mime.startsWith("audio/")) detected = "AUDIO";
    else if (mime === "image/gif") detected = "GIF";
    else if (mime.startsWith("image/")) detected = "IMAGE";
    if (typeSel) typeSel.value = detected;
    // Preenche o nome com o do arquivo (sem extensao) se estiver vazio.
    if (nameInput && !nameInput.value) {
      nameInput.value = file.name.replace(/\.[^.]+$/, "");
    }
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const nameInput = form.elements.namedItem("name") as HTMLInputElement;
    const typeInput = form.elements.namedItem("type") as HTMLSelectElement;
    const tagsInput = form.elements.namedItem("tags") as HTMLInputElement;

    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      const uploadRes = await fetch("/api/media/upload", {
        method: "POST",
        body: uploadForm,
      });
      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error(data.error || "Falha no upload");
      }
      const { url } = await uploadRes.json();

      const tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const createRes = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.value, type: typeInput.value, url, tags }),
      });
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao cadastrar midia");
      }
      const { media: created } = await createRes.json();

      form.reset();
      await loadMedia();

      // "Coloca la e aparece": opcionalmente ja dispara a midia recem-enviada.
      if (autoShow && created?.id) {
        await triggerShow(created.id);
      }
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao enviar midia");
    } finally {
      setUploading(false);
    }
  }

  async function handleShow(item: Media) {
    setTriggeringId(item.id);
    try {
      await triggerShow(item.id);
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao disparar midia");
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleDeleteMedia(item: Media) {
    if (!confirm(`Excluir "${item.name}" da biblioteca? Isso não pode ser desfeito.`)) {
      return;
    }
    setDeletingMediaId(item.id);
    try {
      const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao excluir mídia");
      }
      await loadMedia();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir mídia");
    } finally {
      setDeletingMediaId(null);
    }
  }

  async function handleClear() {
    if (!streamer) {
      alert("Escolha um streamer primeiro (campo Streamer).");
      return;
    }
    setClearing(true);
    try {
      const res = await fetch("/api/trigger/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer: streamer.slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao limpar overlay");
      }
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao limpar overlay");
    } finally {
      setClearing(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/painel/login");
    router.refresh();
  }

  // Feed ao vivo via VDO.Ninja: abre a aba de transmissao do mod e registra
  // no log que ele foi ao vivo. O video trafega pelo VDO.Ninja direto para o
  // OBS (link de scene), nao passa pelo nosso backend.
  const liveEnabled = Boolean(vdoRoom);
  const streamId = useMemo(() => streamIdFromName(modName), [modName]);
  const sceneUrl = useMemo(
    () => (liveEnabled ? buildSceneUrl({ room: vdoRoom, password: vdoPassword }) : ""),
    [liveEnabled, vdoRoom, vdoPassword]
  );

  async function goLive(kind: "camera" | "screen") {
    const url = buildPushUrl(
      { room: vdoRoom, password: vdoPassword },
      streamId,
      { screenshare: kind === "screen" }
    );
    // Abre ANTES do await para nao ser bloqueado como popup pelo navegador.
    window.open(url, "_blank", "noopener");
    try {
      await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      await loadHistory();
    } catch {
      // registro de auditoria e best-effort; nao impede a transmissao.
    }
  }

  async function copyOverlayUrl() {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      alert("Link do seu overlay copiado! Cole no Browser Source do OBS.");
    } catch {
      alert(overlayUrl);
    }
  }

  async function copyScene() {
    try {
      await navigator.clipboard.writeText(sceneUrl);
      alert("Link do OBS copiado!");
    } catch {
      alert(sceneUrl);
    }
  }

  const statusLabel = useMemo(() => {
    if (connectionState === "connected") return "Conectado";
    if (connectionState === "connecting") return "Conectando...";
    return "Desconectado";
  }, [connectionState]);

  return (
    <main className="painel">
      <div className="painel-header">
        <div>
          <h1>Painel do mod</h1>
          <p>{modName}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="status-pill">
            <span className={`status-dot ${connectionState}`} />
            {statusLabel}
          </span>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </div>

      <Diagnostico />

      <section className="panel-section">
        <h2>Streamer</h2>
        <p>
          Escolha para qual <strong>streamer</strong> você vai trabalhar. Tudo o que
          você colocar vai para o <strong>overlay desse streamer</strong> (compartilhado
          entre os mods dele). O link do overlay é fixo — o streamer cola no OBS uma vez
          e nunca muda.
        </p>

        <div className="overlay-link-row">
          <input
            placeholder="Nome do streamer…"
            value={streamerQuery}
            onChange={(e) => setStreamerQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && streamerQuery.trim()) {
                selectStreamer(streamerQuery);
                setStreamerQuery("");
              }
            }}
          />
          <button
            className="primary"
            disabled={!streamerQuery.trim()}
            onClick={() => {
              selectStreamer(streamerQuery);
              setStreamerQuery("");
            }}
          >
            Gerar link / usar
          </button>
        </div>

        {/* Sugestoes (streamers ja usados neste navegador) que casam com a busca. */}
        {recentStreamers.filter(
          (s) =>
            !streamerQuery.trim() ||
            s.name.toLowerCase().includes(streamerQuery.trim().toLowerCase())
        ).length > 0 && (
          <div className="streamer-chips">
            {recentStreamers
              .filter(
                (s) =>
                  !streamerQuery.trim() ||
                  s.name.toLowerCase().includes(streamerQuery.trim().toLowerCase())
              )
              .map((s) => (
                <span key={s.slug} className="streamer-chip">
                  <button
                    className={streamer?.slug === s.slug ? "primary" : ""}
                    onClick={() => selectStreamer(s.name)}
                    title="Usar este streamer"
                  >
                    {s.name}
                  </button>
                  <button
                    className="streamer-chip-x"
                    onClick={() => forgetStreamer(s.slug)}
                    title="Remover da lista"
                    aria-label="Remover"
                  >
                    ✕
                  </button>
                </span>
              ))}
          </div>
        )}

        {streamer ? (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ margin: "0 0 0.4rem" }}>
              Streamer atual: <strong>{streamer.name}</strong>. Link do overlay para o OBS:
            </p>
            <div className="overlay-link-row">
              <input readOnly value={overlayUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="primary" onClick={copyOverlayUrl}>
                Copiar link
              </button>
            </div>
          </div>
        ) : (
          <p className="mesa-bg-note" style={{ marginTop: "0.75rem" }}>
            Nenhum streamer selecionado. Escolha um acima para poder colocar mídias.
          </p>
        )}
      </section>

      <Mesa
        media={media}
        modSlug={modSlug}
        streamerSlug={streamer?.slug ?? ""}
        streamerName={streamer?.name ?? ""}
        onAction={loadHistory}
        vdoRoom={vdoRoom}
        vdoPassword={vdoPassword}
        twitchChannel={twitchChannel}
      />

      <section className="panel-section">
        <h2>Transmitir ao vivo</h2>
        {liveEnabled ? (
          <>
            <p>
              Abre sua câmera ou tela ao vivo no OBS do streamer. Mantenha a aba
              que abrir aberta enquanto estiver transmitindo.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="primary" onClick={() => goLive("camera")}>
                📹 Transmitir câmera
              </button>
              <button className="primary" onClick={() => goLive("screen")}>
                🖥️ Transmitir tela
              </button>
            </div>
            <details className="obs-help">
              <summary>Configurar no OBS (uma vez, feito pelo streamer)</summary>
              <p>
                No OBS: Fontes → + → Navegador, e cole o link abaixo. Ele mostra
                automaticamente quem estiver ao vivo.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input readOnly value={sceneUrl} style={{ flex: "1 1 260px" }} />
                <button onClick={copyScene}>Copiar</button>
              </div>
            </details>
          </>
        ) : (
          <p>
            Recurso desativado. Configure a variável <code>VDO_ROOM</code> (e,
            opcionalmente, <code>VDO_PASSWORD</code>) para habilitar o ao vivo.
          </p>
        )}
      </section>

      <section className="panel-section">
        <h2>Disparar / Limpar</h2>
        <button className="danger" onClick={handleClear} disabled={clearing}>
          {clearing ? "Limpando..." : "Limpar overlay agora"}
        </button>

        <div className="filters" style={{ marginTop: "1rem" }}>
          <input
            placeholder="Buscar por nome"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Todos os tipos</option>
            <option value="IMAGE">Imagem</option>
            <option value="GIF">Gif</option>
            <option value="VIDEO">Video</option>
            <option value="AUDIO">Audio</option>
          </select>
        </div>

        <div className="media-grid">
          {media.map((item) => (
            <div className="media-card" key={item.id}>
              {item.type === "VIDEO" ? (
                <video className="media-thumb" src={item.url} muted />
              ) : item.type === "AUDIO" ? (
                <div className="media-thumb media-thumb-audio">🔊</div>
              ) : (
                <img className="media-thumb" src={item.url} alt={item.name} />
              )}
              <strong>{item.name}</strong>
              <span className="media-type">{TYPE_LABEL[item.type]}</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  className="primary"
                  style={{ flex: 1 }}
                  onClick={() => handleShow(item)}
                  disabled={triggeringId === item.id}
                >
                  {triggeringId === item.id ? "Disparando..." : "Mostrar"}
                </button>
                <button
                  className="danger"
                  onClick={() => handleDeleteMedia(item)}
                  disabled={deletingMediaId === item.id}
                  title="Excluir da biblioteca"
                  aria-label="Excluir"
                >
                  {deletingMediaId === item.id ? "…" : "🗑"}
                </button>
              </div>
            </div>
          ))}
          {media.length === 0 && <p>Nenhuma midia encontrada.</p>}
        </div>
      </section>

      <section className="panel-section">
        <h2>Cadastrar nova midia</h2>
        <form
          onSubmit={handleUpload}
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          <input name="name" placeholder="Nome" required />
          <select name="type" required defaultValue="IMAGE">
            <option value="IMAGE">Imagem</option>
            <option value="GIF">Gif</option>
            <option value="VIDEO">Video</option>
            <option value="AUDIO">Audio</option>
          </select>
          <input name="tags" placeholder="Tags (separadas por virgula)" />
          <input
            name="file"
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={onPickFile}
            required
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={autoShow}
              onChange={(e) => setAutoShow(e.target.checked)}
            />
            Mostrar no overlay assim que enviar
          </label>
          <button className="primary" type="submit" disabled={uploading}>
            {uploading ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </section>

      <section className="panel-section">
        <h2>Historico</h2>
        <ul className="history-list">
          {history.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.actor}</strong> — {entry.action}
              {entry.mediaName ? ` — ${entry.mediaName}` : ""} —{" "}
              {new Date(entry.createdAt).toLocaleString("pt-BR")}
            </li>
          ))}
          {history.length === 0 && <li>Nenhuma acao registrada ainda.</li>}
        </ul>
      </section>
    </main>
  );
}
