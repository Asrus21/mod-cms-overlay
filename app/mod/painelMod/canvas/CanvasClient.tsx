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
  // Canal do proprio usuario. A aba "Editores" e sempre sobre ELE, nunca sobre
  // o streamer que esta aberto na mesa no momento.
  const [meuCanal, setMeuCanal] = useState("");
  // O acesso a mesa aberta foi tirado enquanto ela estava em uso?
  const [acessoRemovido, setAcessoRemovido] = useState(false);
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
        setMeuCanal(String(data.login || "").toLowerCase());
        const found = last ? list.find((s) => s.slug === last!.slug) : undefined;
        const freeSearch = !found && last && data.master ? last : null;
        const initial = found ?? freeSearch ?? list.find((s) => s.self);
        if (initial) setStreamer(initial);
      })
      .catch(() => {});
  }, []);

  // Confere se o acesso a mesa aberta ainda vale.
  //
  // O streamer pode tirar o acesso de alguem a qualquer momento, e quem esta
  // com a mesa aberta continuaria mexendo nela ate tentar alguma coisa. Aqui a
  // lista e relida de tempos em tempos (e sempre que a aba volta ao foco, que
  // e quando a pessoa costuma voltar a mexer): se o canal sumiu de la, ele sai
  // da lista na hora e a tela e trancada.
  const conferirAcesso = useCallback(async () => {
    // A propria mesa e a busca livre do master nunca dependem de concessao.
    if (!streamer || streamer.self || streamer.slug === meuCanal || master) return;
    try {
      const r = await fetch("/api/me/streamers");
      if (!r.ok) return;
      const data = await r.json();
      const logins: string[] = (data.streamers || []).map((x: { login: string }) => x.login);
      if (logins.includes(streamer.slug)) return;
      setLista((antes) => antes.filter((x) => x.slug !== streamer.slug));
      setAcessoRemovido(true);
    } catch {
      // Sem rede: nao da para concluir nada; tenta de novo no proximo ciclo.
    }
  }, [streamer, meuCanal, master]);

  useEffect(() => {
    if (!streamer || streamer.self || streamer.slug === meuCanal || master) {
      setAcessoRemovido(false);
      return;
    }
    const id = setInterval(conferirAcesso, 20000);
    const aoFocar = () => conferirAcesso();
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoFocar);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoFocar);
    };
  }, [conferirAcesso, streamer, meuCanal, master]);

  // Volta para a propria mesa depois de perder o acesso.
  function voltarParaMinhaMesa() {
    setAcessoRemovido(false);
    const minha = lista.find((x) => x.self) ?? (meuCanal ? { slug: meuCanal, name: meuCanal, self: true } : null);
    if (minha) pickEntry(minha);
  }

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
        meuCanal={meuCanal}
        onAction={carregarMidia}
        master={master}
        vdoRoom={vdoRoom}
        vdoPassword={vdoPassword}
        twitchChannel={twitchChannel}
      />

      {/* Cadeado: o acesso a esta mesa foi tirado enquanto ela estava aberta.
          Cobre a tela inteira porque qualquer acao daqui em diante ja seria
          recusada pelo servidor — melhor dizer o que houve do que deixar a
          pessoa tentando. */}
      {acessoRemovido && streamer && (
        <div className="acesso-removido" role="alertdialog" aria-modal="true">
          <div className="acesso-removido-caixa">
            <span className="acesso-removido-icone" aria-hidden="true">🔒</span>
            <strong>Seu acesso foi removido</strong>
            <p>
              Você não tem mais acesso à mesa de <strong>{streamer.name}</strong>. O
              canal saiu da sua lista.
            </p>
            <button className="primary" onClick={voltarParaMinhaMesa}>
              Ir para a minha mesa
            </button>
          </div>
        </div>
      )}
    </>
  );
}
