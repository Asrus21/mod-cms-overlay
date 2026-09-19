"use client";

import { useCallback, useEffect, useState } from "react";
import { Mesa } from "../Mesa";
import { PUBLIC_ORIGIN } from "@/lib/public-origin";
import { streamerSlug } from "@/lib/slug";

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

type Media = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  tags: string[];
};

type StreamerEntry = { slug: string; name: string; self?: boolean };

export function CanvasClient({
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
  const [streamer, setStreamer] = useState<StreamerEntry | null>(null);
  const [lista, setLista] = useState<StreamerEntry[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [master, setMaster] = useState(false);
  // Busca livre do master: alcanca qualquer canal, mesmo fora da lista.
  const [busca, setBusca] = useState("");

  // Streamer atual: mesma chave do painel, para a tela exclusiva abrir ja no
  // streamer que o usuario estava usando la (e vice-versa).
  useEffect(() => {
    let last: { slug: string; name: string } | null = null;
    try {
      const raw = localStorage.getItem("streamerAtual");
      if (raw) {
        const parsed = JSON.parse(raw) as { slug?: string; name?: string };
        if (parsed?.slug) last = { slug: parsed.slug, name: parsed.name || parsed.slug };
      }
      if (!last) {
        const legacy = localStorage.getItem("streamerAtualSlug");
        if (legacy) last = { slug: legacy, name: legacy };
      }
    } catch {
      // ignora
    }
    fetch("/api/me/streamers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const list: StreamerEntry[] = (data.streamers || []).map(
          (s: { login: string; name: string; self?: boolean }) => ({
            slug: s.login,
            name: s.name,
            self: Boolean(s.self),
          })
        );
        setLista(list);
        setMaster(Boolean(data.master));
        const found = last ? list.find((s) => s.slug === last!.slug) : undefined;
        const freeSearch = !found && last && data.master ? last : null;
        const initial = found ?? freeSearch ?? list.find((s) => s.self);
        if (initial) setStreamer(initial);
      })
      .catch(() => {});
  }, []);

  // Biblioteca de midias do usuario (para o seletor "Colocar na mesa").
  //
  // Recarregavel: a mesa agora cadastra midia sozinha (envio de arquivo e
  // emotes), entao ela precisa avisar para a lista nao ficar velha ate alguem
  // recarregar a pagina.
  const carregarMidia = useCallback(() => {
    fetch("/api/media")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.media)) setMedia(data.media);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    carregarMidia();
  }, [carregarMidia]);

  function pick(slug: string) {
    const entry = lista.find((s) => s.slug === slug);
    if (!entry) return;
    setStreamer(entry);
    try {
      localStorage.setItem("streamerAtual", JSON.stringify(entry));
      localStorage.setItem("streamerAtualSlug", entry.slug);
    } catch {
      // ignora
    }
  }

  const overlayUrl = streamer ? `${PUBLIC_ORIGIN}/overlay/${streamer.slug}` : "";

  async function copyOverlay() {
    if (!overlayUrl) return;
    try {
      await navigator.clipboard.writeText(overlayUrl);
      alert("Link do overlay copiado! Cole no Browser Source do OBS.");
    } catch {
      alert(overlayUrl);
    }
  }

  return (
    <>
      {/* Barra flutuante do topo: streamer atual e link do OBS. Nao ha mais
          "voltar": o canvas E o painel, e /mod/painelMod so redireciona para
          ca. */}
      <header className="canvas-topbar">
        <label className="canvas-streamer">
          <span>Streamer</span>
          <select value={streamer?.slug ?? ""} onChange={(e) => pick(e.target.value)}>
            {!streamer && <option value="">Escolha…</option>}
            {lista.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.self ? "★ " : ""}
                {s.name}
              </option>
            ))}
            {/* Busca livre do master restaurada que nao esta na lista. */}
            {streamer && !lista.some((s) => s.slug === streamer.slug) && (
              <option value={streamer.slug}>{streamer.name}</option>
            )}
          </select>
        </label>

        {/* So o master: abrir a mesa de um canal que nao esta na lista dele. */}
        {master && (
          <label className="canvas-busca">
            <span className="sr-only">Buscar streamer</span>
            <input
              placeholder="Abrir outro canal…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const slug = streamerSlug(busca);
                if (!slug) return;
                setStreamer({ slug, name: busca.trim() });
                try {
                  localStorage.setItem(
                    "streamerAtual",
                    JSON.stringify({ slug, name: busca.trim() })
                  );
                } catch {
                  /* sem storage: so nao lembra na proxima visita */
                }
                setBusca("");
              }}
            />
          </label>
        )}

        {overlayUrl && (
          <button onClick={copyOverlay} title={overlayUrl}>
            📋 Copiar link do OBS
          </button>
        )}
      </header>

      <Mesa
        fullscreen
        media={media}
        modSlug={modSlug}
        streamerSlug={streamer?.slug ?? ""}
        streamerName={streamer?.name ?? ""}
        modName={modName}
        onAction={carregarMidia}
        master={master}
        vdoRoom={vdoRoom}
        vdoPassword={vdoPassword}
        twitchChannel={twitchChannel}
      />
    </>
  );
}
