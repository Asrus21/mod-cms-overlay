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
  // Codigo de convite: quem recebe um digita aqui e passa a ter acesso a mesa
  // daquele streamer, sem precisar ser mod do canal.
  const [codigo, setCodigo] = useState("");
  const [usandoCodigo, setUsandoCodigo] = useState(false);

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
    if (entry) pickEntry(entry);
  }

  // Abre a mesa de um streamer e lembra a escolha. Separado de `pick` porque o
  // convite ja traz a entrada pronta, antes de ela estar na lista.
  function pickEntry(entry: StreamerEntry) {
    setStreamer(entry);
    try {
      localStorage.setItem("streamerAtual", JSON.stringify(entry));
      localStorage.setItem("streamerAtualSlug", entry.slug);
    } catch {
      // ignora
    }
  }

  const overlayUrl = streamer ? `${PUBLIC_ORIGIN}/overlay/${streamer.slug}` : "";

  async function usarCodigo() {
    const c = codigo.trim();
    if (!c || usandoCodigo) return;
    setUsandoCodigo(true);
    try {
      const res = await fetch("/api/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Código inválido");
      setCodigo("");
      const novo: StreamerEntry = { slug: data.streamer, name: data.streamerName };
      // Entra na lista e ja abre a mesa liberada.
      setLista((antes) => (antes.some((x) => x.slug === novo.slug) ? antes : [...antes, novo]));
      pickEntry(novo);
      alert(`Pronto! Você agora tem acesso à mesa de ${novo.name}.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Não foi possível usar o código");
    } finally {
      setUsandoCodigo(false);
    }
  }

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
                pickEntry({ slug, name: busca.trim() });
                setBusca("");
              }}
            />
          </label>
        )}

        {/* Codigo de convite, ao lado do link do OBS: e o caminho de quem
            recebeu acesso de um streamer. */}
        <label className="canvas-codigo">
          <span className="sr-only">Código de convite</span>
          <input
            placeholder="Código de acesso…"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") usarCodigo();
            }}
          />
          {codigo.trim() && (
            <button className="primary" onClick={usarCodigo} disabled={usandoCodigo}>
              {usandoCodigo ? "…" : "Usar"}
            </button>
          )}
        </label>

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
