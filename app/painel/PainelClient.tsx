"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import Pusher from "pusher-js";
import { OVERLAY_CHANNEL } from "@/lib/realtime";

type Media = {
  id: string;
  name: string;
  type: "IMAGE" | "GIF" | "VIDEO";
  url: string;
  tags: string[];
};

type AuditEntry = {
  id: string;
  action: "SHOW" | "CLEAR" | "UPLOAD";
  createdAt: string;
  mod: { displayName: string };
  media: { name: string } | null;
};

const DEFAULT_DURATION_MS = 5000;

export function PainelClient({ modName }: { modName: string }) {
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">(
    "connecting"
  );
  const [media, setMedia] = useState<Media[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
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

    pusher.subscribe(OVERLAY_CHANNEL);

    return () => {
      pusher.unsubscribe(OVERLAY_CHANNEL);
      pusher.disconnect();
    };
  }, []);

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
      const uploadRes = await fetch("/api/media/upload", { method: "POST", body: uploadForm });
      if (!uploadRes.ok) throw new Error("Falha no upload");
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
      if (!createRes.ok) throw new Error("Falha ao cadastrar midia");

      form.reset();
      await loadMedia();
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
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: item.id, durationMs: DEFAULT_DURATION_MS }),
      });
      if (!res.ok) throw new Error("Falha ao disparar midia");
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao disparar midia");
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const res = await fetch("/api/trigger/clear", { method: "POST" });
      if (!res.ok) throw new Error("Falha ao limpar overlay");
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao limpar overlay");
    } finally {
      setClearing(false);
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
          <button onClick={() => signOut()}>Sair</button>
        </div>
      </div>

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
          </select>
        </div>

        <div className="media-grid">
          {media.map((item) => (
            <div className="media-card" key={item.id}>
              {item.type === "VIDEO" ? (
                <video className="media-thumb" src={item.url} muted />
              ) : (
                <img className="media-thumb" src={item.url} alt={item.name} />
              )}
              <strong>{item.name}</strong>
              <button
                className="primary"
                onClick={() => handleShow(item)}
                disabled={triggeringId === item.id}
              >
                {triggeringId === item.id ? "Disparando..." : "Mostrar"}
              </button>
            </div>
          ))}
          {media.length === 0 && <p>Nenhuma midia encontrada.</p>}
        </div>
      </section>

      <section className="panel-section">
        <h2>Cadastrar nova midia</h2>
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <input name="name" placeholder="Nome" required />
          <select name="type" required defaultValue="IMAGE">
            <option value="IMAGE">Imagem</option>
            <option value="GIF">Gif</option>
            <option value="VIDEO">Video</option>
          </select>
          <input name="tags" placeholder="Tags (separadas por virgula)" />
          <input name="file" type="file" accept="image/*,video/*" required />
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
              <strong>{entry.mod.displayName}</strong> — {entry.action}
              {entry.media ? ` — ${entry.media.name}` : ""} —{" "}
              {new Date(entry.createdAt).toLocaleString("pt-BR")}
            </li>
          ))}
          {history.length === 0 && <li>Nenhuma acao registrada ainda.</li>}
        </ul>
      </section>
    </main>
  );
}
