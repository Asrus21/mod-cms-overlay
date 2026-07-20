"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Pusher from "pusher-js";
import { streamerSlug } from "@/lib/slug";
import { buildPushUrl, buildSceneUrl, streamIdFromName } from "@/lib/vdo";
import { Mesa } from "./Mesa";
import { ThemeToggle } from "../../ThemeToggle";

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

type Media = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  tags: string[];
};

const DEFAULT_DURATION_MS = 5000;

const TYPE_LABEL: Record<MediaType, string> = {
  IMAGE: "Imagem",
  GIF: "Gif",
  VIDEO: "Video",
  AUDIO: "Audio",
};

// Formata a data/hora do primeiro login em pt-BR (ex.: 20/07/2026 às 14:32).
function formatLoginDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const data = d.toLocaleDateString("pt-BR");
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${data} às ${hora}`;
}

export function PainelClient({
  modName,
  modSlug,
  modPhoto,
  isMaster,
  vdoRoom,
  vdoPassword,
  twitchChannel,
}: {
  modName: string;
  modSlug: string;
  modPhoto: string;
  isMaster: boolean;
  vdoRoom: string;
  vdoPassword: string;
  twitchChannel: string;
}) {
  const router = useRouter();
  // Streamer alvo: o overlay e por streamer. O mod escolhe UM streamer que ele
  // modera (lista vinda da Twitch); tudo o que ele colocar vai para o overlay
  // desse streamer. A mesa e individual por streamer (os itens de um nao
  // aparecem no outro; ao voltar, continuam la). O master (asrus12) tambem pode
  // buscar qualquer streamer.
  const [streamer, setStreamer] = useState<{ slug: string; name: string } | null>(null);
  const [moderated, setModerated] = useState<{ slug: string; name: string }[]>([]);
  const [loadingStreamers, setLoadingStreamers] = useState(true);
  const [streamerQuery, setStreamerQuery] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    let lastSlug: string | null = null;
    try {
      lastSlug = localStorage.getItem("streamerAtualSlug");
    } catch {
      // ignora
    }
    // Canais que o mod modera (da Twitch, salvos no login).
    fetch("/api/me/streamers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const list: { slug: string; name: string }[] = (data.streamers || []).map(
          (s: { login: string; name: string }) => ({ slug: s.login, name: s.name })
        );
        setModerated(list);
        // Restaura o ultimo streamer escolhido (se ainda estiver na lista, ou
        // se for master — que pode ter escolhido qualquer um).
        if (lastSlug) {
          const found = list.find((s) => s.slug === lastSlug);
          if (found) setStreamer(found);
        }
      })
      .finally(() => setLoadingStreamers(false));
  }, []);

  const overlayUrl = streamer ? `${origin}/overlay/${streamer.slug}` : "";

  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [media, setMedia] = useState<Media[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [autoShow, setAutoShow] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  // Acesso concedido "na mao": quem pode usar a mesa deste streamer sem ser mod.
  const [grants, setGrants] = useState<{ userLogin: string; grantedBy: string }[]>([]);
  const [grantInput, setGrantInput] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  // Historico de logins (SO master): primeiro acesso de cada usuario no painel.
  const [logins, setLogins] = useState<
    { login: string; display: string; firstLoginAt: string }[]
  >([]);

  // Carrega o historico de logins — apenas para o master (asrus12).
  useEffect(() => {
    if (!isMaster) return;
    fetch("/api/me/logins")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.logins)) setLogins(data.logins);
      })
      .catch(() => {});
  }, [isMaster]);

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

  // Define o streamer atual (escolhido da lista de moderados). Guarda so o slug
  // do ultimo escolhido para restaurar ao recarregar.
  function pickStreamer(entry: { slug: string; name: string }) {
    setStreamer(entry);
    try {
      localStorage.setItem("streamerAtualSlug", entry.slug);
    } catch {
      // ignora
    }
  }

  // Busca livre (SO master): qualquer streamer, mesmo sem moderar. O slug e
  // deterministico a partir do nome digitado.
  function searchStreamer(name: string) {
    const trimmed = name.trim();
    const slug = streamerSlug(trimmed);
    if (!slug) return;
    pickStreamer({ slug, name: trimmed });
    setStreamerQuery("");
  }

  // Acesso a mesa: carrega/adiciona/remove pessoas que podem usar a mesa do
  // streamer atual mesmo sem serem mod dele na Twitch.
  const loadGrants = useCallback(async (slug: string) => {
    if (!slug) {
      setGrants([]);
      return;
    }
    try {
      const res = await fetch(`/api/access?streamer=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = await res.json();
        setGrants(Array.isArray(data.grants) ? data.grants : []);
      } else {
        setGrants([]);
      }
    } catch {
      setGrants([]);
    }
  }, []);

  useEffect(() => {
    loadGrants(streamer?.slug ?? "");
  }, [streamer, loadGrants]);

  async function addGrant() {
    const userLogin = grantInput.trim().replace(/^@/, "").toLowerCase();
    if (!userLogin || !streamer) return;
    setGrantBusy(true);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamer: streamer.slug,
          streamerName: streamer.name,
          userLogin,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao adicionar");
      }
      setGrantInput("");
      await loadGrants(streamer.slug);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao adicionar");
    } finally {
      setGrantBusy(false);
    }
  }

  async function removeGrant(userLogin: string) {
    if (!streamer) return;
    try {
      await fetch("/api/access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer: streamer.slug, userLogin }),
      });
      await loadGrants(streamer.slug);
    } catch {
      // silencioso
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

  useEffect(() => {
    loadMedia();
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao limpar overlay");
    } finally {
      setClearing(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/mod/painelMod/login");
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
          <h1>Bastidores</h1>
          <p>Controle o overlay dos seus streamers</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="status-pill">
            <span className={`status-dot ${connectionState}`} />
            {statusLabel}
          </span>
          <ThemeToggle />
          {/* Identidade da Twitch: nick + foto num circulo a direita. */}
          <span className="mod-identity">
            <span className="mod-nick">
              {modName}
              {isMaster && <span className="mod-master" title="Usuário master">★</span>}
            </span>
            {modPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mod-avatar" src={modPhoto} alt={modName} />
            ) : (
              <span className="mod-avatar mod-avatar-fallback">
                {modName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </div>

      <section className="panel-section">
        <h2>Streamer</h2>
        <p>
          Escolha <strong>um</strong> streamer que você modera. Tudo o que você
          colocar vai para o <strong>overlay dele</strong>. A mesa é{" "}
          <strong>individual por streamer</strong> — ao trocar, os itens do outro
          somem; ao voltar, continuam lá.
        </p>

        {loadingStreamers ? (
          <p className="mesa-bg-note">Carregando seus streamers…</p>
        ) : moderated.length > 0 ? (
          <div className="streamer-list">
            {moderated.map((s) => (
              <button
                key={s.slug}
                className={`streamer-item${streamer?.slug === s.slug ? " selected" : ""}`}
                onClick={() => pickStreamer(s)}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="mesa-bg-note">
            Você ainda não modera nenhum canal na Twitch (ou a lista não carregou).
            {isMaster ? " Use a busca abaixo." : " Peça para o streamer te dar mod e faça login de novo."}
          </p>
        )}

        {/* Busca livre: SO para o usuario master (asrus12). */}
        {isMaster && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="mesa-bg-note" style={{ marginTop: 0 }}>
              <strong>Master:</strong> buscar qualquer streamer (mesmo sem moderar).
            </p>
            <div className="overlay-link-row">
              <input
                placeholder="Nome do streamer…"
                value={streamerQuery}
                onChange={(e) => setStreamerQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && streamerQuery.trim()) searchStreamer(streamerQuery);
                }}
              />
              <button
                className="primary"
                disabled={!streamerQuery.trim()}
                onClick={() => searchStreamer(streamerQuery)}
              >
                Usar
              </button>
            </div>
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

            {/* Dar acesso a mesa deste streamer a quem NAO e mod dele. */}
            <div className="access-box">
              <p className="mesa-bg-label" style={{ marginBottom: "0.35rem" }}>
                Pessoas com acesso à mesa de <strong>{streamer.name}</strong>
              </p>
              <p className="mesa-bg-note" style={{ marginTop: 0 }}>
                Adicione um <strong>usuário da Twitch</strong> (mesmo que não seja
                mod deste streamer) para ele poder usar a mesa deste streamer.
              </p>
              <div className="overlay-link-row">
                <input
                  placeholder="usuário da Twitch…"
                  value={grantInput}
                  onChange={(e) => setGrantInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && grantInput.trim()) addGrant();
                  }}
                />
                <button
                  className="primary"
                  onClick={addGrant}
                  disabled={grantBusy || !grantInput.trim()}
                >
                  {grantBusy ? "Adicionando…" : "Adicionar"}
                </button>
              </div>
              {grants.length > 0 && (
                <div className="access-list">
                  {grants.map((g) => (
                    <span key={g.userLogin} className="access-chip">
                      {g.userLogin}
                      <button
                        className="access-chip-x"
                        title="Remover acesso"
                        aria-label="Remover acesso"
                        onClick={() => removeGrant(g.userLogin)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
        onAction={() => {}}
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

      {/* Historico de logins: exclusivo do master (asrus12). */}
      {isMaster && (
        <section className="panel-section">
          <h2>Histórico de logins</h2>
          {logins.length === 0 ? (
            <p className="mesa-bg-note" style={{ marginTop: 0 }}>
              Nenhum login registrado ainda.
            </p>
          ) : (
            <ul className="login-history">
              {logins.map((u) => (
                <li key={u.login}>
                  Usuário: <strong>{u.display}</strong> fez login pela primeira
                  vez em {formatLoginDate(u.firstLoginAt)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
