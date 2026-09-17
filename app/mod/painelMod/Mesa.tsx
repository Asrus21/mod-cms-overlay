"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildObsPushUrl, buildObsViewUrl } from "@/lib/vdo";
import { WIDGET_LABEL, WidgetView, parseWidget, type WidgetKind } from "../../WidgetView";
import { MAX_WIDGET_CODE } from "@/lib/widgets";
import { clampPos } from "@/lib/stage";
import { PUBLIC_ORIGIN } from "@/lib/public-origin";
import { nomeDoArquivo, tipoDoArquivo, type TipoMidia } from "@/lib/media-tipo";
import { filtrarEmotes, type Emote } from "@/lib/emotes";
import {
  QUALIDADES,
  QUALIDADE_PADRAO,
  canalDaEntrada,
  isQualidade,
  urlDoPlayer,
  type QualidadeId,
} from "@/lib/twitch-player";

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

type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT" | "EMBED" | "WIDGET";

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

// Intervalo minimo entre mensagens de movimento enviadas ao overlay.
// ATENCAO: anda junto com a `transition` de .overlay-movable no globals.css.
// A transicao precisa durar um pouco MAIS que este intervalo; se durar menos,
// o item termina a animacao e fica parado ate a proxima mensagem, engasgando.
const MOVE_THROTTLE_MS = 120;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const MIN_SCALE = 0.005;
const MAX_SCALE = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function genId() {
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const HANDLES = ["tl", "tr", "bl", "br", "t", "b", "l", "r"] as const;
// Texto so tem alças com componente horizontal (o tamanho e a fonte).
const TEXT_HANDLES = ["tl", "tr", "bl", "br", "l", "r"] as const;
type Handle = (typeof HANDLES)[number];

// Redimensionamento "ancorado no lado oposto" (estilo OBS): o lado agarrado
// segue o cursor e o lado oposto fica fixo. Guardamos a ancora e as direcoes
// calculadas no pointer-down.
type ResizeState = {
  itemId: string;
  isText: boolean;
  hasX: boolean;
  hasY: boolean;
  dirX: number; // -1 (agarrou a esquerda) ou +1 (direita)
  dirY: number; // -1 (topo) ou +1 (base)
  anchorX: number; // borda oposta fixa, fracao da largura (0..1)
  anchorY: number; // borda oposta fixa, fracao da altura (0..1)
  startX: number;
  startY: number | null;
  startCX: number;
  startCY: number;
};

type DragState = {
  itemId: string;
  startCX: number;
  startCY: number;
  startClientX: number;
  startClientY: number;
};

// Remodelar livre (Alt + arrastar sobre o item): muda largura e altura de forma
// independente, a partir do CENTRO — o item nao sai do lugar enquanto voce
// molda. Nao precisa acertar as alcinhas, e pode distorcer de proposito.
type FreeResizeState = {
  itemId: string;
  isText: boolean;
  startClientX: number;
  startClientY: number;
  startScaleX: number;
  startScaleY: number | null;
};

// Item de uma cena salva, como vem de /api/scenes/<id> (ja normalizado no
// servidor por lib/scenes.ts).
type SceneSnapshotItem = {
  mediaId: string | null;
  url: string;
  name: string;
  type: MediaType;
  text?: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number | null;
  volume: number;
  muted: boolean;
  hidden: boolean;
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
  fullscreen = false,
}: {
  media: Media[];
  modSlug: string;
  streamerSlug: string;
  streamerName: string;
  onAction: () => void;
  vdoRoom: string;
  vdoPassword: string;
  twitchChannel: string;
  // true = tela exclusiva (palco em tela cheia + paineis flutuantes).
  fullscreen?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Viewport rolavel que envolve o palco — usado para o zoom com Ctrl+scroll
  // (ajustamos o scroll para o zoom ficar centrado no ponteiro do mouse).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const freeRef = useRef<FreeResizeState | null>(null);
  // Elementos de midia da previa (video/audio) por itemId, para aplicar
  // volume/mudo e pausar quando oculto.
  const mediaEls = useRef<Map<string, HTMLMediaElement>>(new Map());
  // Caixas dos itens por itemId, para medir a altura natural ao redimensionar.
  const boxEls = useRef<Map<string, HTMLDivElement>>(new Map());
  // "Area de transferencia" da mesa: guarda uma copia do item selecionado
  // (Ctrl+C) para colar (Ctrl+V) exatamente igual, com um leve deslocamento.
  const clipboardRef = useRef<PlacedItem | null>(null);
  // Midias que a propria mesa cadastrou nesta sessao, por URL.
  //
  // Serve para o mesmo emote clicado duas vezes nao virar duas linhas na
  // biblioteca. Nao da para confiar so na lista `media` que vem por prop: ela
  // e recarregada pelo componente de cima e a resposta pode nao ter chegado
  // ainda quando o segundo clique acontece.
  const cadastradasAqui = useRef<Map<string, Media>>(new Map());

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
  // Caixa "Feed ao vivo": o mod cola o link do player (relay do OBS dele) e vira
  // um item na mesa — aparece no mesmo overlay do streamer que as demais midias.
  const [embedInput, setEmbedInput] = useState("");
  // Menu da engrenagem: ajustes da mesa, link do OBS e a lista de atalhos.
  const [configAberto, setConfigAberto] = useState(false);
  // Qual grupo do menu esta aberto (um por vez; null = todos fechados).
  const [grupoAberto, setGrupoAberto] = useState<string | null>("mesa");
  // Aviso de "copiado" do link do OBS, que volta ao normal sozinho.
  const [copiado, setCopiado] = useState(false);
  // O menu vai para o body por portal, entao so pode ser montado no cliente.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  // Grade de alinhamento sobre o palco. Só visual (não vai para o overlay);
  // fica guardada no navegador para não voltar desligada a cada visita.
  const [grade, setGrade] = useState(false);
  // Painel de mídia: aba aberta e filtro por tipo da biblioteca.
  const [abaMidia, setAbaMidia] = useState<"biblioteca" | "enviar" | "emotes">("biblioteca");
  // Emotes do canal (Twitch + 7TV/BTTV/FFZ), carregados sob demanda.
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [emotesFontes, setEmotesFontes] = useState<Record<string, { ok: boolean; total: number; erro?: string }>>({});
  const [emotesEstado, setEmotesEstado] = useState<"vazio" | "carregando" | "pronto" | "erro">("vazio");
  const [emotesErro, setEmotesErro] = useState("");
  const [buscaEmote, setBuscaEmote] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoMidia>("todos");
  // Envio de arquivo direto da mesa.
  const [envArquivo, setEnvArquivo] = useState<File | null>(null);
  const [envNome, setEnvNome] = useState("");
  const [envTipo, setEnvTipo] = useState<TipoMidia>("IMAGE");
  const [enviando, setEnviando] = useState(false);

  // Qualidade da live usada como FUNDO da mesa. Mais baixa por padrão: o fundo
  // fica tocando o tempo todo e serve só de guia, então não vale gastar banda
  // (nem quadros) com 1080p60 nele.
  const [bgQualidade, setBgQualidade] = useState<QualidadeId>("480p30");
  // Transmissão da Twitch: canal, qualidade e se entra com áudio.
  const [twitchCanal, setTwitchCanal] = useState("");
  const [twitchQ, setTwitchQ] = useState<QualidadeId>(QUALIDADE_PADRAO);
  const [twitchAudio, setTwitchAudio] = useState(false);
  // Ferramenta de inserção aberta na barra de ícones (null = só os ícones).
  const [ferramenta, setFerramenta] = useState<
    "midia" | "texto" | "widget" | "feed" | "twitch" | null
  >(null);
  // Widget a adicionar: tipo, rotulo opcional e (na contagem) a duracao.
  const [widgetKind, setWidgetKind] = useState<WidgetKind>("clock");
  const [widgetLabel, setWidgetLabel] = useState("");
  const [widgetMinutes, setWidgetMinutes] = useState("10");
  // Widget personalizado: codigo do proprio mod, em abas separadas.
  const [wAba, setWAba] = useState<"html" | "css" | "js">("html");
  const [wHtml, setWHtml] = useState('<div id="oi">Olá!</div>');
  const [wCss, setWCss] = useState("#oi{font:700 48px system-ui;color:#fff}");
  const [wJs, setWJs] = useState("");
  // Zoom da previa da mesa (1x..5x). So aumenta a visualizacao para ajustar
  // itens pequenos com precisao — nao muda o tamanho real no overlay.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Cenas salvas: arranjos nomeados da mesa deste mod neste streamer.
  const [scenes, setScenes] = useState<
    { id: string; name: string; count: number }[]
  >([]);
  const [sceneName, setSceneName] = useState("");
  const [sceneBusy, setSceneBusy] = useState(false);
  // Motivo de as cenas estarem indisponiveis (ex.: tabela nao criada no banco).
  // Sem isto a lista apareceria vazia, como se so nao houvesse cena salva.
  const [sceneErro, setSceneErro] = useState("");

  // Alt segurado: muda o cursor sobre os itens, senao ninguem descobre que da
  // para remodelar sem acertar as alcinhas.
  const [altHeld, setAltHeld] = useState(false);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<BgMode>("none");
  // O canal da Twitch usado como fundo e SEMPRE o streamer selecionado (aba
  // Streamer) — nao ha mais input manual. streamerSlug = login do streamer.
  const twitchCh = streamerSlug;

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

  // Fundo da mesa com a live do streamer.
  //
  // Vai pela NOSSA pagina do player (/mod/player/twitch) em vez de um iframe
  // direto do player.twitch.tv: e ela que consegue impor a qualidade — a
  // Twitch nao aceita isso pela URL (ver lib/twitch-player.ts). Aqui isso
  // importa mais que no item da mesa, porque o fundo fica tocando o tempo
  // todo enquanto se monta a cena: em 1080p60 e banda gasta a toa, e num
  // computador mais fraco tira quadros da propria mesa.
  //
  // Sempre mudo: e um guia para posicionar, e o som entraria em cima do
  // audio que o mod ja esta ouvindo da live.
  //
  // Sai da origem ABERTA no momento, e nao do dominio canonico como o item da
  // mesa: o fundo nao e gravado em lugar nenhum, entao nao ha link antigo para
  // honrar — e assim ele funciona igual em preview e no desenvolvimento, em
  // vez de puxar a pagina de producao de dentro deles.
  const origemAtual = typeof window !== "undefined" ? window.location.origin : "";
  const twitchSrc = twitchCh && origemAtual ? urlDoPlayer(origemAtual, twitchCh, bgQualidade) : "";

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
    if (item) await colocarNaMesa(item);
  }

  // Coloca uma midia da biblioteca na mesa. Recebe o objeto (e nao o id)
  // porque o envio de arquivo precisa colocar o que acabou de cadastrar, sem
  // esperar a lista da biblioteca recarregar.
  async function colocarNaMesa(item: Media) {
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

  // Envio de arquivo direto da mesa.
  //
  // Antes so dava para colocar o que ja estava na biblioteca: para usar algo
  // novo era preciso sair da mesa, ir ao formulario de cadastro do painel,
  // enviar e voltar. E o mesmo caminho de duas etapas do painel (arquivo para
  // /api/media/upload, metadados para /api/media), e no fim o item ja entra na
  // mesa.
  async function handleEnviar() {
    if (!envArquivo || enviando) return;
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    const nome = envNome.trim() || nomeDoArquivo(envArquivo.name) || "sem nome";
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", envArquivo);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!up.ok) {
        const data = await up.json().catch(() => ({}));
        throw new Error(data.error || "Falha no upload");
      }
      const { url } = (await up.json()) as { url: string };

      const criar = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, type: envTipo, url, tags: [] }),
      });
      if (!criar.ok) {
        const data = await criar.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao cadastrar a mídia");
      }
      const { media: criada } = (await criar.json()) as { media: Media };
      if (criada) cadastradasAqui.current.set(url, criada);

      setEnvArquivo(null);
      setEnvNome("");
      // Recarrega a biblioteca do painel para a nova midia aparecer na lista.
      onAction();
      if (criada) await colocarNaMesa(criada);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setEnviando(false);
    }
  }

  // Carrega os emotes do canal na primeira vez que a aba abre (e a cada troca
  // de streamer). Sao quatro consultas externas la no servidor, entao nao vale
  // fazer isso no carregamento da mesa.
  useEffect(() => {
    if (abaMidia !== "emotes" || !streamerSlug) return;
    let vivo = true;
    setEmotesEstado("carregando");
    setEmotesErro("");
    fetch(`/api/emotes?streamer=${encodeURIComponent(streamerSlug)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Falha ao buscar os emotes");
        return data as { emotes: Emote[]; fontes: Record<string, { ok: boolean; total: number; erro?: string }> };
      })
      .then((data) => {
        if (!vivo) return;
        setEmotes(data.emotes || []);
        setEmotesFontes(data.fontes || {});
        setEmotesEstado("pronto");
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        setEmotesErro(err instanceof Error ? err.message : "Falha ao buscar os emotes");
        setEmotesEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [abaMidia, streamerSlug]);

  // Coloca um emote na mesa.
  //
  // Um emote e uma imagem hospedada fora, entao precisa virar uma midia da
  // biblioteca antes: as rotas de disparo exigem mediaId para imagem/gif, e e
  // isso que faz o item voltar ao recarregar o OBS e caber numa cena salva.
  // Se o mesmo emote ja tiver sido usado antes, reaproveitamos o registro em
  // vez de encher a biblioteca de copias.
  async function colocarEmote(e: Emote) {
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    if (placing) return;
    const jaTem = cadastradasAqui.current.get(e.url) ?? media.find((m) => m.url === e.url);
    if (jaTem) {
      await colocarNaMesa(jaTem);
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: e.nome,
          type: e.animado ? "GIF" : "IMAGE",
          url: e.url,
          tags: ["emote", e.origem],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao cadastrar o emote");
      }
      const { media: criada } = (await res.json()) as { media: Media };
      if (criada) cadastradasAqui.current.set(e.url, criada);
      onAction();
      if (criada) await colocarNaMesa(criada);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao colocar o emote");
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

  // Widget: item "vivo" (relogio, contagem regressiva, cronometro). A config
  // vai no campo `text` em JSON; os instantes sao absolutos para todo mundo
  // (mod, overlay, espectador) ver exatamente o mesmo numero.
  async function handleAddWidget() {
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    const agora = Date.now();
    const cfg: Record<string, unknown> = { kind: widgetKind, withSeconds: true };
    if (widgetLabel.trim()) cfg.label = widgetLabel.trim();
    if (widgetKind === "custom") {
      const total = wHtml.length + wCss.length + wJs.length;
      if (total > MAX_WIDGET_CODE) {
        alert(`O código passou de ${MAX_WIDGET_CODE} caracteres (está com ${total}).`);
        return;
      }
      if (!wHtml.trim() && !wJs.trim()) {
        alert("Escreva ao menos o HTML ou o JavaScript do widget.");
        return;
      }
      cfg.html = wHtml;
      cfg.css = wCss;
      cfg.js = wJs;
    }
    if (widgetKind === "countdown") {
      const min = Number(widgetMinutes);
      if (!Number.isFinite(min) || min <= 0) {
        alert("Informe quantos minutos a contagem regressiva deve durar.");
        return;
      }
      cfg.targetAt = agora + min * 60_000;
    }
    if (widgetKind === "stopwatch") cfg.startedAt = agora;

    const content = JSON.stringify(cfg);
    const itemId = genId();
    const placed: PlacedItem = {
      itemId,
      media: { id: itemId, name: WIDGET_LABEL[widgetKind], type: "WIDGET", url: "", tags: [] },
      text: content,
      x: 0.5,
      y: 0.5,
      // O personalizado e uma caixa (iframe), nao texto escalado por fonte.
      scaleX: widgetKind === "custom" ? 0.3 : 0.06,
      scaleY: widgetKind === "custom" ? 0.17 : null,
      volume: 1,
      muted: false,
      // Entra OCULTO, igual aos demais: so aparece no overlay ao clicar em 👁.
      hidden: true,
    };
    try {
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          streamer: streamerSlug,
          type: "WIDGET",
          text: content,
          sticky: true,
          x: 0.5,
          y: 0.5,
          scale: widgetKind === "custom" ? 0.3 : 0.06,
          ...(widgetKind === "custom" ? { scaleY: 0.17 } : {}),
          hidden: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao adicionar widget");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      setWidgetLabel("");
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    }
  }

  // Transmissao da Twitch como item da mesa.
  //
  // Vira um item EMBED comum apontando para /mod/player/twitch — a nossa
  // pagina do player, que e quem consegue impor a qualidade (a Twitch nao
  // aceita isso pela URL; ver lib/twitch-player.ts). Assim nao ha tipo novo no
  // banco e o item entra em cena, e volta ao recarregar o OBS, como os demais.
  async function handleAddTwitch() {
    const canal = canalDaEntrada(twitchCanal);
    if (!canal) {
      alert("Informe o canal da Twitch (ex.: asrus12 ou twitch.tv/asrus12).");
      return;
    }
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    // A URL precisa ser absoluta: o item e um EMBED e a rota de disparo exige
    // um link http(s). Usamos o dominio canonico (e nao o endereco aberto no
    // momento) porque o link fica GRAVADO no item: montado a partir de um
    // preview do Vercel, ele continuaria apontando para o preview depois.
    const link =
      urlDoPlayer(PUBLIC_ORIGIN, canal, twitchQ) + (twitchAudio ? "&audio=1" : "");

    const itemId = genId();
    const placed: PlacedItem = {
      itemId,
      media: {
        id: itemId,
        name: `Twitch: ${canal}`,
        type: "EMBED",
        url: link,
        tags: [],
      },
      x: 0.5,
      y: 0.5,
      // ~1/3 da largura, altura 16:9 (0.333 * 9/16 ≈ 0.1875).
      scaleX: 0.333,
      scaleY: 0.1875,
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
          type: "EMBED",
          url: link,
          sticky: true,
          x: 0.5,
          y: 0.5,
          scale: 0.333,
          scaleY: 0.1875,
          hidden: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao adicionar a transmissão");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      setTwitchCanal("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    }
  }

  // Feed ao vivo: cola o link do player (do seu relay: Cloudflare Stream,
  // MediaMTX, etc.) e ele vira um item na mesa (iframe), aparecendo no MESMO
  // overlay do streamer que as demais midias — um link so mostra mesa + seu OBS.
  async function handleAddEmbed() {
    const link = embedInput.trim();
    if (!link) return;
    if (!/^https?:\/\//i.test(link)) {
      alert("Cole um link http(s) do player do seu feed (ex.: do Cloudflare/MediaMTX).");
      return;
    }
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    const itemId = genId();
    const placed: PlacedItem = {
      itemId,
      media: { id: itemId, name: "Feed ao vivo", type: "EMBED", url: link, tags: [] },
      x: 0.5,
      y: 0.5,
      // ~1/3 da largura, altura 16:9 (0.333 * 9/16 ≈ 0.1875).
      scaleX: 0.333,
      scaleY: 0.1875,
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
          type: "EMBED",
          url: link,
          sticky: true,
          x: 0.5,
          y: 0.5,
          scale: 0.333,
          scaleY: 0.1875,
          hidden: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao adicionar feed ao vivo");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      setEmbedInput("");
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    }
  }

  // Monta o corpo do /trigger/show que recria um item exatamente como ele
  // esta (tamanho, escala, som, visibilidade), na posicao pedida. Usado ao
  // colar (Ctrl+V) e ao aplicar uma cena salva.
  function showPayloadFor(itemId: string, src: PlacedItem, x: number, y: number) {
    const type = src.media.type;
    if (type === "TEXT" || type === "WIDGET") {
      // O widget e recriado com a MESMA config (inclusive o instante alvo da
      // contagem), entao a copia marca exatamente o mesmo tempo do original.
      return {
        itemId, streamer: streamerSlug, type, text: src.text ?? "",
        sticky: true, x, y, scale: src.scaleX, hidden: src.hidden,
      };
    }
    if (type === "EMBED") {
      return {
        itemId, streamer: streamerSlug, type: "EMBED", url: src.media.url,
        sticky: true, x, y, scale: src.scaleX, scaleY: src.scaleY, hidden: src.hidden,
      };
    }
    if (type === "AUDIO") {
      return {
        itemId, mediaId: src.media.id, streamer: streamerSlug, sticky: true,
        volume: src.volume, muted: src.muted, hidden: src.hidden,
      };
    }
    return {
      itemId, mediaId: src.media.id, streamer: streamerSlug, sticky: true,
      x, y, scale: src.scaleX, scaleY: src.scaleY,
      volume: src.volume, muted: src.muted, hidden: src.hidden,
    };
  }

  // Cola (Ctrl+V) uma copia do item guardado no clipboard da mesa, exatamente
  // com o mesmo tamanho/escala/som/estado — apenas deslocado um pouco para nao
  // ficar exatamente por cima do original.
  async function pasteItem(src: PlacedItem) {
    if (!streamerSlug) {
      alert("Escolha um streamer primeiro (campo Streamer acima).");
      return;
    }
    const itemId = genId();
    const nx = clamp(src.x + 0.04, 0.03, 0.97);
    const ny = clamp(src.y + 0.04, 0.03, 0.97);
    const placed: PlacedItem = { ...src, itemId, x: nx, y: ny };
    const payload = showPayloadFor(itemId, src, nx, ny);

    try {
      const res = await fetch("/api/trigger/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao colar");
      }
      setItems((prev) => [...prev, placed]);
      setSelectedId(itemId);
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao colar");
    }
  }

  // --- Cenas salvas ---------------------------------------------------
  // Uma cena e um arranjo nomeado (posicao/tamanho/som/visibilidade) para o
  // mod montar uma vez e reaplicar com um clique. Aplicar SUBSTITUI o que
  // esta na mesa, reusando as rotas de remover e de mostrar.

  const loadScenes = useCallback(async (slug: string) => {
    if (!slug) {
      setScenes([]);
      return;
    }
    try {
      const res = await fetch(`/api/scenes?streamer=${encodeURIComponent(slug)}`);
      const data = res.ok ? await res.json() : null;
      setScenes(Array.isArray(data?.scenes) ? data.scenes : []);
      setSceneErro(data?.unavailable ? String(data.reason || "Cenas indisponíveis.") : "");
    } catch {
      setScenes([]);
      setSceneErro("");
    }
  }, []);

  useEffect(() => {
    loadScenes(streamerSlug);
  }, [streamerSlug, loadScenes]);

  async function saveScene() {
    const name = sceneName.trim();
    if (!name || !streamerSlug) return;
    const jaExiste = scenes.some((s) => s.name.toLowerCase() === name.toLowerCase());
    if (jaExiste && !confirm(`Já existe uma cena "${name}". Sobrescrever?`)) return;

    setSceneBusy(true);
    try {
      // Snapshot do que esta na mesa agora.
      const snapshot = itemsRef.current.map((it) => ({
        mediaId: it.media.type === "TEXT" || it.media.type === "WIDGET" || it.media.type === "EMBED"
          ? null
          : it.media.id,
        url: it.media.url,
        name: it.media.name,
        type: it.media.type,
        text: it.text,
        x: it.x,
        y: it.y,
        scaleX: it.scaleX,
        scaleY: it.scaleY,
        volume: it.volume,
        muted: it.muted,
        hidden: it.hidden,
      }));
      const res = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer: streamerSlug, name, items: snapshot }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao salvar a cena");
      }
      setSceneName("");
      await loadScenes(streamerSlug);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar a cena");
    } finally {
      setSceneBusy(false);
    }
  }

  async function applyScene(id: string, nome: string) {
    if (!streamerSlug) return;
    const atuais = itemsRef.current;
    if (
      atuais.length > 0 &&
      !confirm(`Aplicar a cena "${nome}"? Os ${atuais.length} item(ns) que estão na mesa agora serão removidos.`)
    ) {
      return;
    }

    setSceneBusy(true);
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao ler a cena");
      }
      const { items: snapshot } = (await res.json()) as { items: SceneSnapshotItem[] };

      // 1) Tira o que esta na mesa (o overlay recebe cada remocao ao vivo).
      for (const it of atuais) {
        await fetch("/api/trigger/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: it.itemId, streamer: streamerSlug }),
        }).catch(() => {});
      }
      setItems([]);
      setSelectedId("");
      mediaEls.current.clear();
      boxEls.current.clear();

      // 2) Recria os itens da cena, cada um com um itemId novo.
      const novos: PlacedItem[] = [];
      for (const snap of snapshot) {
        const itemId = genId();
        const placed: PlacedItem = {
          itemId,
          media: {
            id: snap.mediaId ?? itemId,
            name: snap.name || "",
            type: snap.type,
            url: snap.url || "",
            tags: [],
          },
          text: snap.text,
          x: snap.x,
          y: snap.y,
          scaleX: snap.scaleX,
          scaleY: snap.scaleY,
          volume: snap.volume,
          muted: snap.muted,
          hidden: snap.hidden,
        };
        const r = await fetch("/api/trigger/show", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(showPayloadFor(itemId, placed, snap.x, snap.y)),
        });
        // Um item que nao volta (ex.: midia apagada da biblioteca) e pulado —
        // o resto da cena continua sendo aplicado.
        if (r.ok) novos.push(placed);
      }
      setItems(novos);
      if (novos.length < snapshot.length) {
        alert(
          `Cena aplicada, mas ${snapshot.length - novos.length} item(ns) não puderam ser recriados (a mídia pode ter sido excluída da biblioteca).`
        );
      }
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao aplicar a cena");
    } finally {
      setSceneBusy(false);
    }
  }

  async function deleteScene(id: string, nome: string) {
    if (!confirm(`Apagar a cena "${nome}"? Isso não mexe no que está na mesa.`)) return;
    try {
      await fetch("/api/scenes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadScenes(streamerSlug);
    } catch {
      // silencioso
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
      x: clampPos((e.clientX - rect.left) / rect.width),
      y: clampPos((e.clientY - rect.top) / rect.height),
    };
  }

  // --- Arrastar item (delta relativo: o item acompanha o cursor sem "pular") ---
  function onItemPointerDown(e: React.PointerEvent, item: PlacedItem) {
    setSelectedId(item.itemId);

    // Alt segurado: remodela em vez de mover.
    if (e.altKey) {
      e.preventDefault();
      const isText = item.media.type === "TEXT" || item.media.type === "WIDGET";
      // Texto/widget escalam pela fonte (scaleY nao se aplica). Nos demais,
      // se a altura for natural (null), congela a altura atual medida para a
      // remodelagem partir do tamanho que esta na tela.
      let h = item.scaleY;
      if (!isText && h == null) {
        const rect = stageRef.current?.getBoundingClientRect();
        const boxH = boxEls.current.get(item.itemId)?.getBoundingClientRect().height;
        if (rect && boxH) h = clamp(boxH / rect.height, MIN_SCALE, MAX_SCALE);
      }
      freeRef.current = {
        itemId: item.itemId,
        isText,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScaleX: item.scaleX,
        startScaleY: isText ? null : h,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    dragRef.current = {
      itemId: item.itemId,
      startCX: item.x,
      startCY: item.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  // Remodelagem livre: o crescimento e o DOBRO do deslocamento porque o item
  // cresce para os dois lados (ancorado no centro).
  function applyFreeResize(e: React.PointerEvent, commit: boolean) {
    const f = freeRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!f || !rect) return;
    const dx = (e.clientX - f.startClientX) / rect.width;
    const dy = (e.clientY - f.startClientY) / rect.height;

    const nx = clamp(f.startScaleX + dx * 2, MIN_SCALE, MAX_SCALE);
    const patch: Partial<PlacedItem> = f.isText
      ? { scaleX: nx, scaleY: null }
      : {
          scaleX: nx,
          scaleY:
            f.startScaleY == null ? null : clamp(f.startScaleY + dy * 2, MIN_SCALE, MAX_SCALE),
        };
    const next = patchItem(f.itemId, patch);
    if (next) pushMove(next, commit);
  }

  function onStagePointerMove(e: React.PointerEvent) {
    if (freeRef.current) {
      applyFreeResize(e, false);
      return;
    }
    if (resizeRef.current) {
      applyResize(e, false);
      return;
    }
    const d = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    // Move pelo MESMO deslocamento do cursor a partir de onde pegou.
    // Pode passar das bordas: item fora da area visivel fica "guardado" e
    // some da live sem ser removido (ver lib/stage.ts).
    const nx = clampPos(d.startCX + (e.clientX - d.startClientX) / rect.width);
    const ny = clampPos(d.startCY + (e.clientY - d.startClientY) / rect.height);
    const next = patchItem(d.itemId, { x: nx, y: ny });
    if (next) pushMove(next, false);
  }

  function onStagePointerUp(e: React.PointerEvent) {
    if (freeRef.current) {
      applyFreeResize(e, true);
      freeRef.current = null;
      return;
    }
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

  // --- Redimensionar (ancorado no lado oposto, estilo OBS) ---
  function onResizeDown(e: React.PointerEvent, item: PlacedItem, handle: Handle) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(item.itemId);

    const isText = item.media.type === "TEXT" || item.media.type === "WIDGET";
    const grabLeft = handle.includes("l");
    const grabRight = handle.includes("r");
    const grabTop = handle.includes("t");
    const grabBottom = handle.includes("b");
    const hasX = grabLeft || grabRight;
    const hasY = !isText && (grabTop || grabBottom);

    // Altura natural precisa estar "congelada" para ancorar corretamente.
    let h = item.scaleY;
    if (!isText && h == null) {
      const rect = stageRef.current?.getBoundingClientRect();
      const boxH = boxEls.current.get(item.itemId)?.getBoundingClientRect().height;
      if (rect && boxH) h = clamp(boxH / rect.height, MIN_SCALE, MAX_SCALE);
    }
    const hh = h ?? 0;
    const w = item.scaleX;

    // Ancora = borda OPOSTA a que foi agarrada (fica fixa durante o resize).
    // Para TEXTO, o tamanho e a FONTE (nao ha caixa por scaleX), entao a "ancora"
    // guarda a posicao do cursor no down e o resize e por delta (sem pular).
    const dirX = grabLeft ? -1 : 1;
    const dirY = grabTop ? -1 : 1;
    const rectDown = stageRef.current?.getBoundingClientRect();
    const pointerX = rectDown ? (e.clientX - rectDown.left) / rectDown.width : item.x;
    const anchorX = isText
      ? pointerX
      : grabLeft
      ? item.x + w / 2
      : item.x - w / 2;
    const anchorY = grabTop ? item.y + hh / 2 : item.y - hh / 2;

    if (!isText && item.scaleY == null && hh > 0) {
      patchItem(item.itemId, { scaleY: hh });
    }

    resizeRef.current = {
      itemId: item.itemId,
      isText,
      hasX,
      hasY,
      dirX,
      dirY,
      anchorX,
      anchorY,
      startX: w,
      startY: isText ? null : hh,
      startCX: item.x,
      startCY: item.y,
    };
  }

  function applyResize(e: React.PointerEvent, commit: boolean) {
    const r = resizeRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!r || !rect) return;

    const cx = (e.clientX - rect.left) / rect.width; // fracao da largura
    const cy = (e.clientY - rect.top) / rect.height; // fracao da altura

    // Texto: delta relativo ao ponto agarrado (anchorX = cursor no down).
    if (r.isText) {
      const deltaFrac = (cx - r.anchorX) * r.dirX;
      const nx = clamp(r.startX + deltaFrac, MIN_SCALE, MAX_SCALE);
      const nextText = patchItem(r.itemId, { scaleX: nx, scaleY: null, x: r.startCX, y: r.startCY });
      if (nextText) pushMove(nextText, commit);
      return;
    }

    let nx = r.startX;
    let ny: number | null = r.startY;
    let ncx = r.startCX;
    let ncy = r.startCY;

    if (r.hasX) {
      const signedW = (cx - r.anchorX) * r.dirX; // largura crescendo a partir da ancora
      nx = clamp(signedW, MIN_SCALE, MAX_SCALE);
      ncx = clampPos(r.anchorX + (r.dirX * nx) / 2);
    }
    if (r.hasY) {
      const signedH = (cy - r.anchorY) * r.dirY;
      ny = clamp(signedH, MIN_SCALE, MAX_SCALE);
      ncy = clampPos(r.anchorY + (r.dirY * ny) / 2);
    }

    const patch = r.isText
      ? { scaleX: nx, scaleY: null, x: ncx, y: r.startCY }
      : { scaleX: nx, scaleY: ny, x: ncx, y: ncy };
    const next = patchItem(r.itemId, patch);
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

  // Atalhos de teclado para mostrar/esconder itens sem usar o mouse. Ignorados
  // enquanto o mod estiver digitando em algum campo (input/textarea/select).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Esc fecha o menu de configuracoes ANTES da checagem abaixo: o foco
      // costuma estar num campo dele (caixa, seletor), e ai a tecla seria
      // ignorada e o menu nao fecharia.
      if (e.key === "Escape" && configAberto) {
        setConfigAberto(false);
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd + C: copia o item selecionado para o clipboard da mesa.
      if (mod && !e.altKey && (e.key === "c" || e.key === "C")) {
        const item = getItem(selectedId);
        if (item) {
          e.preventDefault();
          clipboardRef.current = { ...item };
        }
        return;
      }
      // Ctrl/Cmd + V: cola a copia guardada, igual e um pouco deslocada.
      if (mod && !e.altKey && (e.key === "v" || e.key === "V")) {
        if (clipboardRef.current) {
          e.preventDefault();
          pasteItem(clipboardRef.current);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : Number(e.key) - 1;
        const item = itemsRef.current[idx];
        if (item) {
          e.preventDefault();
          toggleHidden(item);
        }
        return;
      }

      if (e.code === "Space") {
        const item = getItem(selectedId);
        if (item) {
          e.preventDefault();
          toggleHidden(item);
        }
        return;
      }

      if (e.key === "Escape") {
        setSelectedId("");
        setConfigAberto(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, streamerSlug, configAberto]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true); };
    const onUp = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false); };
    // Trocar de janela com Alt pressionado deixaria o cursor preso no estado.
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  // A grade fica guardada no navegador (so preferencia visual deste mod).
  //
  // A leitura e num efeito de montagem (nao no estado inicial) porque o HTML e
  // gerado no servidor, onde nao ha localStorage — ler no render daria
  // divergencia de hidratacao. E a gravacao acontece na propria troca, NAO num
  // efeito com [grade]: um efeito desses tambem dispara na montagem, com o
  // valor padrao, e apagaria a preferencia guardada antes de le-la.
  const GRADE_KEY = "bastidores:grade";
  const BG_Q_KEY = "bastidores:fundo-qualidade";
  useEffect(() => {
    try {
      if (localStorage.getItem(GRADE_KEY) === "1") setGrade(true);
      const q = localStorage.getItem(BG_Q_KEY);
      if (isQualidade(q)) setBgQualidade(q);
    } catch {
      /* navegador sem storage (anonimo, OBS): segue no padrao */
    }
  }, []);

  function trocarBgQualidade(q: QualidadeId) {
    setBgQualidade(q);
    try {
      localStorage.setItem(BG_Q_KEY, q);
    } catch {
      /* idem: a preferencia so nao sobrevive ao recarregar */
    }
  }

  function trocarGrade(ligada: boolean) {
    setGrade(ligada);
    try {
      localStorage.setItem(GRADE_KEY, ligada ? "1" : "0");
    } catch {
      /* idem: a preferencia so nao sobrevive ao recarregar */
    }
  }

  // Pan: Ctrl + botao ESQUERDO arrastando, ou o botao do MEIO. Move a area
  // visivel sem mexer em nenhum item. E o par natural do zoom na roda — com a
  // roda dando zoom, ela nao rola mais o viewport, entao o arrasto e o unico
  // jeito de se deslocar pela mesa.
  //
  // O Ctrl e o que separa "arrastar a tela" de "arrastar o item": sem ele, o
  // botao esquerdo continua movendo o elemento como sempre.
  // Deslocamento da mesa, em pixels de tela.
  //
  // NAO usa scrollLeft/scrollTop: a rolagem so tem alcance quando o palco
  // transborda o viewport, entao no zoom normal o arrasto simplesmente nao
  // saia do lugar — so "rolava" quando ja estava bem perto da borda. Aqui o
  // deslocamento e uma translacao livre, sem limite, nos dois eixos ao mesmo
  // tempo (inclusive na diagonal).
  //
  // Fica num ref, e nao no estado, porque ele muda a cada evento de ponteiro:
  // pelo estado seria um re-render da mesa inteira por quadro. O valor e
  // escrito direto nas custom properties do palco.
  const panAtual = useRef({ x: 0, y: 0 });

  const aplicarPan = useCallback(() => {
    const st = stageRef.current;
    if (!st) return;
    st.style.setProperty("--pan-x", `${panAtual.current.x}px`);
    st.style.setProperty("--pan-y", `${panAtual.current.y}px`);
  }, []);

  function resetarVista() {
    panAtual.current = { x: 0, y: 0 };
    aplicarPan();
    setZoom(1);
  }

  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // Ha um pan com Ctrl em andamento? Serve para segurar o menu de contexto no
  // macOS, onde Ctrl + clique equivale ao botao direito.
  const panComCtrl = useRef(false);

  // Roda na fase de CAPTURA, antes dos handlers dos itens: com Ctrl segurado
  // precisamos barrar o evento (stopPropagation) para o item sob o cursor nao
  // comecar a ser arrastado junto com a tela.
  function onViewportPointerDown(e: React.PointerEvent) {
    const comCtrl = e.button === 0 && (e.ctrlKey || e.metaKey);
    if (e.button !== 1 && !comCtrl) return;
    const el = viewportRef.current;
    if (!el) return;
    e.preventDefault();
    if (comCtrl) {
      e.stopPropagation();
      panComCtrl.current = true;
    }
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      px: panAtual.current.x,
      py: panAtual.current.y,
    };
    el.classList.add("panning");
    el.setPointerCapture(e.pointerId);

    const mover = (ev: PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      // A mesa acompanha o ponteiro (pegar e arrastar), sem teto: para cima,
      // para baixo, para os lados e na diagonal.
      panAtual.current = { x: p.px + (ev.clientX - p.x), y: p.py + (ev.clientY - p.y) };
      aplicarPan();
    };
    const soltar = () => {
      panRef.current = null;
      el.classList.remove("panning");
      // Solta o travamento do menu de contexto so no proximo quadro: no macOS
      // o contextmenu chega depois do pointerup.
      if (panComCtrl.current) {
        requestAnimationFrame(() => {
          panComCtrl.current = false;
        });
      }
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  // No macOS, Ctrl + clique abre o menu de contexto; aqui esse gesto e o pan.
  function onViewportContextMenu(e: React.MouseEvent) {
    if (panComCtrl.current || e.ctrlKey || e.metaKey) e.preventDefault();
  }

  // Zoom com a roda do mouse, ancorado no ponteiro.
  //
  // O ponto do palco que esta sob o cursor precisa continuar sob o cursor
  // depois do zoom. Em vez de calcular onde o palco vai parar (ele e
  // centralizado por `margin:auto` na tela cheia e alinhado a esquerda no
  // painel — contas diferentes), guardamos a fracao do palco sob o cursor e,
  // ja com o novo tamanho aplicado, medimos onde ela foi parar e corrigimos o
  // deslocamento pela diferenca. Serve para os dois modos sem saber do layout.
  const ancoraZoom = useRef<{ u: number; v: number; cx: number; cy: number } | null>(null);

  useLayoutEffect(() => {
    const a = ancoraZoom.current;
    if (!a) return;
    ancoraZoom.current = null;
    const st = stageRef.current;
    if (!st) return;
    const r = st.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Onde a fracao ancorada esta agora, depois do novo zoom.
    const foiParar = { x: r.left + a.u * r.width, y: r.top + a.v * r.height };
    panAtual.current = {
      x: panAtual.current.x + (a.cx - foiParar.x),
      y: panAtual.current.y + (a.cy - foiParar.y),
    };
    aplicarPan();
  }, [zoom, aplicarPan]);

  // Muda o zoom mantendo fixo o ponto (cx, cy) da tela.
  const zoomarEm = useCallback((novo: number, cx: number, cy: number) => {
    const st = stageRef.current;
    if (st) {
      const r = st.getBoundingClientRect();
      if (r.width && r.height) {
        ancoraZoom.current = {
          u: (cx - r.left) / r.width,
          v: (cy - r.top) / r.height,
          cx,
          cy,
        };
      }
    }
    setZoom(novo);
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    function onWheel(e: WheelEvent) {
      // A roda SEMPRE da zoom sobre a mesa, nos dois modos. O viewport nao
      // rola (overflow:hidden), entao nao ha rolagem para disputar com ela;
      // para se deslocar, arraste com Ctrl (ou com o botao do meio).
      e.preventDefault(); // evita o zoom do navegador
      const oldZoom = zoomRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === oldZoom) return;
      zoomarEm(newZoom, e.clientX, e.clientY);
    }

    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomarEm]);

  // --- Blocos de UI reaproveitados nos dois modos (secao do painel e tela
  // exclusiva em tela cheia). A logica de interacao e a mesma; muda so o
  // arranjo: no modo tela cheia eles viram paineis flutuantes sobre o palco.
  // Barra de inserção: ícones pequenos (como a barra do canvas do Pogly). Cada
  // um diz o que é ao passar o mouse e, ao clicar, abre o painel com os campos
  // daquele tipo. Antes eram quatro linhas de controle empilhadas, que comiam
  // boa parte da tela mesmo quando não se ia adicionar nada.
  const FERRAMENTAS = [
    { id: "midia", icone: "🖼️", nome: "Mídia da biblioteca" },
    { id: "texto", icone: "🔤", nome: "Texto na tela" },
    { id: "widget", icone: "⏱️", nome: "Widget (relógio, contagem, cronômetro)" },
    { id: "feed", icone: "📡", nome: "Feed ao vivo do seu OBS" },
    { id: "twitch", icone: "🟣", nome: "Transmissão da Twitch" },
  ] as const;

  const FILTROS_TIPO: ReadonlyArray<{ id: "todos" | TipoMidia; rotulo: string }> = [
    { id: "todos", rotulo: "Todos" },
    { id: "IMAGE", rotulo: "Imagens" },
    { id: "GIF", rotulo: "Gifs" },
    { id: "VIDEO", rotulo: "Vídeos" },
    { id: "AUDIO", rotulo: "Áudios" },
  ];
  const ICONE_TIPO: Record<string, string> = {
    IMAGE: "🖼️",
    GIF: "🎞️",
    VIDEO: "🎬",
    AUDIO: "🔊",
  };
  const contaPorTipo = (t: "todos" | TipoMidia) =>
    t === "todos" ? media.length : media.filter((m) => m.type === t).length;
  const midiasFiltradas =
    filtroTipo === "todos" ? media : media.filter((m) => m.type === filtroTipo);

  const ROTULO_ORIGEM: Record<string, string> = {
    twitch: "Twitch",
    "7tv": "7TV",
    bttv: "BTTV",
    ffz: "FFZ",
  };
  const emotesVisiveis = filtrarEmotes(emotes, buscaEmote);
  const fontesComFalha = Object.entries(emotesFontes)
    .filter(([, e]) => !e.ok)
    .map(([nome]) => ROTULO_ORIGEM[nome] ?? nome);

  const addControls = (
    <div className="mesa-add">
      <div className="mesa-tools">
        {FERRAMENTAS.map((f) => (
          <button
            key={f.id}
            className={`mesa-tool${ferramenta === f.id ? " ativa" : ""}`}
            aria-label={f.nome}
            aria-pressed={ferramenta === f.id}
            disabled={!streamerSlug}
            onClick={() => setFerramenta(ferramenta === f.id ? null : f.id)}
          >
            <span aria-hidden="true">{f.icone}</span>
            <span className="mesa-tool-dica">{f.nome}</span>
          </button>
        ))}

        {/* A engrenagem fica na MESMA barra dos demais icones. Ela nao abre um
            painel aqui embaixo como os outros: abre o menu de configuracoes,
            que e uma janela por cima da mesa. Por isso vem depois de um
            separador — e uma ferramenta de ajuste, nao de inserir. */}
        <span className="mesa-tools-sep" aria-hidden="true" />
        <button
          className={`mesa-tool${configAberto ? " ativa" : ""}`}
          aria-label="Configurações"
          aria-expanded={configAberto}
          onClick={() => setConfigAberto((v) => !v)}
        >
          <span aria-hidden="true">⚙️</span>
          <span className="mesa-tool-dica">Configurações</span>
        </button>
      </div>

      {ferramenta === "midia" && (
        <div className="mesa-tool-painel coluna">
          <div className="mesa-abas">
            <button
              className={`mesa-aba${abaMidia === "biblioteca" ? " ativa" : ""}`}
              onClick={() => setAbaMidia("biblioteca")}
            >
              Biblioteca
            </button>
            <button
              className={`mesa-aba${abaMidia === "enviar" ? " ativa" : ""}`}
              onClick={() => setAbaMidia("enviar")}
            >
              Enviar arquivo
            </button>
            <button
              className={`mesa-aba${abaMidia === "emotes" ? " ativa" : ""}`}
              onClick={() => setAbaMidia("emotes")}
            >
              Emotes
            </button>
          </div>

          {abaMidia === "biblioteca" && (
            <>
              {/* Filtro por tipo: uma lista unica misturando imagem, gif, video
                  e audio fica impossivel de achar nada depois de algumas
                  dezenas de itens. */}
              <div className="mesa-filtros">
                {FILTROS_TIPO.map((f) => (
                  <button
                    key={f.id}
                    className={`mesa-filtro${filtroTipo === f.id ? " ativa" : ""}`}
                    onClick={() => {
                      setFiltroTipo(f.id);
                      setPickId("");
                    }}
                  >
                    {f.rotulo}
                    <span className="mesa-filtro-n">{contaPorTipo(f.id)}</span>
                  </button>
                ))}
              </div>
              <div className="mesa-tool-linha">
                <select
                  value={pickId}
                  onChange={(e) => setPickId(e.target.value)}
                  aria-label="Mídia"
                  style={{ flex: "1 1 200px" }}
                >
                  <option value="">
                    {midiasFiltradas.length ? "Escolha uma mídia…" : "Nada deste tipo na biblioteca"}
                  </option>
                  {midiasFiltradas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {ICONE_TIPO[m.type] ?? ""} {m.name}
                    </option>
                  ))}
                </select>
                <button className="primary" onClick={handlePlace} disabled={!pickId || placing}>
                  {placing ? "Colocando…" : "Colocar na mesa"}
                </button>
              </div>
            </>
          )}

          {abaMidia === "enviar" && (
            <>
              <div className="mesa-tool-linha">
                <input
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setEnvArquivo(f);
                    if (f) {
                      setEnvTipo(tipoDoArquivo(f.type, f.name));
                      if (!envNome.trim()) setEnvNome(nomeDoArquivo(f.name));
                    }
                  }}
                />
              </div>
              <div className="mesa-tool-linha">
                <input
                  placeholder="Nome"
                  value={envNome}
                  onChange={(e) => setEnvNome(e.target.value)}
                  style={{ flex: "1 1 160px" }}
                />
                <select
                  value={envTipo}
                  onChange={(e) => setEnvTipo(e.target.value as TipoMidia)}
                  aria-label="Tipo"
                >
                  <option value="IMAGE">Imagem</option>
                  <option value="GIF">Gif</option>
                  <option value="VIDEO">Vídeo</option>
                  <option value="AUDIO">Áudio</option>
                </select>
                <button
                  className="primary"
                  onClick={handleEnviar}
                  disabled={!envArquivo || enviando}
                >
                  {enviando ? "Enviando…" : "Enviar e colocar"}
                </button>
              </div>
              <p className="mesa-bg-note" style={{ margin: 0 }}>
                O arquivo entra na <strong>sua biblioteca</strong> (ninguém mais a vê) e já
                vai para a mesa, oculto. O tipo é detectado pelo arquivo — troque se errar.
              </p>
            </>
          )}

          {abaMidia === "emotes" && (
            <>
              <div className="mesa-tool-linha">
                <input
                  placeholder="Buscar emote…"
                  value={buscaEmote}
                  onChange={(e) => setBuscaEmote(e.target.value)}
                  style={{ flex: "1 1 160px" }}
                />
                <span className="mesa-audio-note">
                  {emotesEstado === "pronto" ? `${emotesVisiveis.length} de ${emotes.length}` : ""}
                </span>
              </div>

              {emotesEstado === "carregando" && (
                <p className="mesa-bg-note" style={{ margin: 0 }}>Buscando os emotes do canal…</p>
              )}
              {emotesEstado === "erro" && <p className="scene-erro">⚠️ {emotesErro}</p>}

              {emotesEstado === "pronto" && (
                <>
                  {emotes.length === 0 ? (
                    <p className="mesa-bg-note" style={{ margin: 0 }}>
                      Nenhum emote encontrado para este canal.
                    </p>
                  ) : (
                    <ul className="mesa-emotes">
                      {emotesVisiveis.slice(0, 200).map((e) => (
                        <li key={`${e.origem}:${e.id}`}>
                          <button
                            className="mesa-emote"
                            onClick={() => colocarEmote(e)}
                            disabled={placing}
                            title={`${e.nome} · ${ROTULO_ORIGEM[e.origem]}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.url} alt={e.nome} loading="lazy" />
                            <span className="mesa-emote-nome">{e.nome}</span>
                            <span className="mesa-emote-origem" data-origem={e.origem}>
                              {ROTULO_ORIGEM[e.origem]}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Uma fonte fora do ar nao pode passar despercebida como
                      "o canal nao tem emotes". */}
                  {fontesComFalha.length > 0 && (
                    <p className="mesa-bg-note" style={{ margin: 0 }}>
                      Não deu para consultar: <strong>{fontesComFalha.join(", ")}</strong>.
                      Os demais emotes estão aí.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {ferramenta === "texto" && (
        <div className="mesa-tool-painel">
          <input
            autoFocus
            placeholder="Texto para a tela…"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddText();
            }}
          />
          <button className="primary" onClick={handleAddText} disabled={!textInput.trim()}>
            Adicionar
          </button>
        </div>
      )}

      {ferramenta === "widget" && (
        <div className="mesa-tool-painel">
          <select
            value={widgetKind}
            onChange={(e) => setWidgetKind(e.target.value as WidgetKind)}
            aria-label="Tipo de widget"
          >
            <option value="clock">⏰ Relógio</option>
            <option value="countdown">⏳ Contagem regressiva</option>
            <option value="stopwatch">⏱ Cronômetro</option>
            <option value="custom">{"</>"} Personalizado (código)</option>
          </select>
          {widgetKind === "countdown" && (
            <input
              type="number"
              min={1}
              value={widgetMinutes}
              onChange={(e) => setWidgetMinutes(e.target.value)}
              aria-label="Duração em minutos"
              title="Duração em minutos"
              style={{ width: "5rem", flex: "none" }}
            />
          )}
          <input
            placeholder="Rótulo (opcional)…"
            value={widgetLabel}
            onChange={(e) => setWidgetLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddWidget();
            }}
          />
          <button className="primary" onClick={handleAddWidget}>
            Adicionar
          </button>

          {widgetKind === "custom" && (
            <div className="widget-editor">
              <div className="widget-abas">
                {(["html", "css", "js"] as const).map((k) => (
                  <button
                    key={k}
                    className={`widget-aba${wAba === k ? " ativa" : ""}`}
                    onClick={() => setWAba(k)}
                  >
                    {k.toUpperCase()}
                  </button>
                ))}
                <span className="widget-contagem">
                  {wHtml.length + wCss.length + wJs.length}/{MAX_WIDGET_CODE}
                </span>
              </div>
              <textarea
                className="widget-codigo"
                spellCheck={false}
                value={wAba === "html" ? wHtml : wAba === "css" ? wCss : wJs}
                onChange={(e) =>
                  wAba === "html"
                    ? setWHtml(e.target.value)
                    : wAba === "css"
                    ? setWCss(e.target.value)
                    : setWJs(e.target.value)
                }
                placeholder={
                  wAba === "html"
                    ? "<div id=\"oi\">Olá!</div>"
                    : wAba === "css"
                    ? "#oi { color: #fff }"
                    : "// roda dentro do widget, isolado do painel"
                }
              />
              <p className="mesa-bg-note" style={{ margin: 0 }}>
                O código roda <strong>isolado</strong> (iframe sandbox): não alcança o
                painel, seus cookies nem o overlay. Para dado ao vivo, use{" "}
                <code>fetch</code> numa API pública.
              </p>
            </div>
          )}
        </div>
      )}

      {ferramenta === "twitch" && (
        <div className="mesa-tool-painel coluna">
          <div className="mesa-twitch-linha">
            <input
              autoFocus
              placeholder="Canal da Twitch (ex.: asrus12)"
              value={twitchCanal}
              onChange={(e) => setTwitchCanal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTwitch();
              }}
              style={{ flex: "1 1 160px" }}
            />
            <select
              value={twitchQ}
              onChange={(e) => setTwitchQ(e.target.value as QualidadeId)}
              aria-label="Qualidade da transmissão"
            >
              {QUALIDADES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.rotulo}
                </option>
              ))}
            </select>
            <label className="mesa-twitch-audio">
              <input
                type="checkbox"
                checked={twitchAudio}
                onChange={(e) => setTwitchAudio(e.target.checked)}
              />
              Com áudio
            </label>
            <button
              className="primary"
              onClick={handleAddTwitch}
              disabled={!twitchCanal.trim()}
            >
              Adicionar
            </button>
          </div>
          <p className="mesa-bg-note" style={{ margin: 0 }}>
            A transmissão do canal vira um item da mesa, na qualidade escolhida. Se o
            canal não oferecer essa opção (nem todo canal tem 1080p ou 60fps), entra a
            melhor que couber abaixo dela. Sem áudio por padrão, para não somar ao áudio
            do streamer.
          </p>
        </div>
      )}

      {ferramenta === "feed" && (
        <div className="mesa-tool-painel coluna">
          <div className="mesa-tool-linha">
            <input
              autoFocus
              placeholder="Link do player do seu OBS…"
              value={embedInput}
              onChange={(e) => setEmbedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddEmbed();
              }}
            />
            <button className="primary" onClick={handleAddEmbed} disabled={!embedInput.trim()}>
              Adicionar
            </button>
          </div>
          <p className="mesa-bg-note" style={{ margin: 0 }}>
            Transmita seu OBS para um <strong>relay</strong> (Cloudflare Stream, MediaMTX…) e
            cole aqui o <strong>link do player</strong>. Ele vira um item na mesa e aparece no
            mesmo overlay do streamer.
          </p>
        </div>
      )}

      {!streamerSlug && (
        <p className="mesa-bg-note" style={{ margin: 0 }}>
          Escolha um <strong>streamer</strong> para começar.
        </p>
      )}
    </div>
  );

  const sceneControls = (
    <div className="mesa-scenes">
      <div className="mesa-controls">
        <input
          placeholder="Nome da cena (ex.: Intervalo)…"
          value={sceneName}
          onChange={(e) => setSceneName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveScene();
          }}
          style={{ flex: "1 1 160px" }}
        />
        <button
          onClick={saveScene}
          disabled={sceneBusy || !sceneName.trim() || !streamerSlug}
          title="Salva o arranjo que está na mesa agora"
        >
          {sceneBusy ? "…" : "💾 Salvar cena"}
        </button>
      </div>
      {sceneErro && <p className="scene-erro">⚠️ {sceneErro}</p>}
      {scenes.length > 0 && (
        <ul className="scene-list">
          {scenes.map((s) => (
            <li key={s.id} className="scene-item">
              <button
                className="scene-apply"
                onClick={() => applyScene(s.id, s.name)}
                disabled={sceneBusy}
                title="Aplicar esta cena (substitui o que está na mesa)"
              >
                <span className="scene-name">{s.name}</span>
                <span className="scene-count">{s.count} item(ns)</span>
              </button>
              <button
                onClick={() => deleteScene(s.id, s.name)}
                title="Apagar a cena"
                aria-label="Apagar a cena"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const bgControls = (
    <>
      <div className="mesa-bg-row">
        <label className="mesa-bg-label">
          Fundo da mesa (guia para posicionar)
          <select value={bgMode} onChange={(e) => setBgMode(e.target.value as BgMode)}>
            <option value="none">Sem fundo</option>
            <option value="twitch">Transmissão ao vivo do streamer</option>
            <option value="ref">Fundo fake (imagem de referência / print)</option>
            {liveConfigured && <option value="obs">Tela do OBS ao vivo (VDO.Ninja)</option>}
          </select>
        </label>

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
        {bgMode === "twitch" && streamerSlug && (
          <label className="mesa-bg-label">
            Qualidade da live no fundo
            <select
              value={bgQualidade}
              onChange={(e) => trocarBgQualidade(e.target.value as QualidadeId)}
            >
              {QUALIDADES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.rotulo}
                </option>
              ))}
            </select>
          </label>
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
          {streamerSlug ? (
            <>
              Usa a transmissão da Twitch de{" "}
              <strong>{streamerName || streamerSlug}</strong> como fundo (o
              streamer selecionado). Você não precisa abrir nada. Tem alguns
              segundos de atraso (normal da Twitch). Só aparece com a live no ar.
              A qualidade vale só para este fundo — quanto mais baixa, menos
              banda e menos peso enquanto você monta a cena.
            </>
          ) : (
            <>Escolha um <strong>streamer</strong> na seção acima para usar a live dele como fundo.</>
          )}
        </p>
      )}
    </>
  );

  const audioControls =
    selected && (selected.media.type === "VIDEO" || selected.media.type === "AUDIO") ? (
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
    ) : null;

  const zoomControls = (
      <div className="mesa-zoom-row">
        <span>Zoom</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => {
            // Pela barra nao ha ponteiro sobre a mesa: ancora no centro do
            // viewport, senao a mesa escaparia da vista ao ampliar.
            const r = viewportRef.current?.getBoundingClientRect();
            const novo = Number(e.target.value);
            if (r) zoomarEm(novo, r.left + r.width / 2, r.top + r.height / 2);
            else setZoom(novo);
          }}
        />
        <span className="mesa-scale-value">{zoom.toFixed(2)}×</span>
        <button onClick={resetarVista} title="Volta ao 1× e recentraliza a mesa">
          Centralizar
        </button>
        <span className="mesa-audio-note">
          Roda do mouse dá zoom (centrado no ponteiro). Para andar pela mesa,
          arraste segurando <strong>Ctrl</strong> (ou com o botão do meio).
          Abaixo de 1× você enxerga o que está estacionado fora. Só muda a
          visualização, não afeta o overlay.
        </span>
      </div>
  );

  // Menu da engrenagem.
  //
  // Junta o que estava espalhado pela tela (fundo da mesa, zoom, link do OBS)
  // e, principalmente, DOCUMENTA os atalhos: ate agora eles existiam mas nao
  // apareciam em lugar nenhum, entao so servia para quem ja soubesse.
  const ATALHOS: ReadonlyArray<{ tecla: string; oque: string }> = [
    { tecla: "1 … 9, 0", oque: "Mostra/esconde o elemento daquela posição na lista" },
    { tecla: "Espaço", oque: "Mostra/esconde o elemento selecionado" },
    { tecla: "Esc", oque: "Tira a seleção (e fecha este menu)" },
    { tecla: "Ctrl + C", oque: "Copia o elemento selecionado" },
    { tecla: "Ctrl + V", oque: "Cola a cópia, do mesmo jeito e um pouco ao lado" },
    { tecla: "Roda do mouse", oque: "Zoom da visualização, centrado no ponteiro" },
    { tecla: "Ctrl + arrastar", oque: "Anda pela mesa (o botão do meio também)" },
    { tecla: "Alt + arrastar", oque: "Remodela o elemento livremente" },
    { tecla: "Arrastar as bordas", oque: "Cantos: largura e altura · laterais: largura · topo/base: altura" },
  ];

  const obsUrl = streamerSlug ? `${PUBLIC_ORIGIN}/overlay/${streamerSlug}` : "";

  const GRUPOS_CONFIG: ReadonlyArray<{
    id: string;
    nome: string;
    resumo: string;
    conteudo: React.ReactNode;
  }> = [
    {
      id: "mesa",
      nome: "Mesa",
      resumo: "fundo, zoom e grade",
      conteudo: (
        <>
          {bgControls}
          {zoomControls}
          <label className="mesa-config-opcao">
            <input
              type="checkbox"
              checked={grade}
              onChange={(e) => trocarGrade(e.target.checked)}
            />
            Grade de alinhamento
            <span className="mesa-audio-note">Só aqui na mesa — não aparece na live.</span>
          </label>
        </>
      ),
    },
    {
      id: "obs",
      nome: "OBS",
      resumo: "link do overlay",
      conteudo: obsUrl ? (
        <>
          <p className="mesa-config-link">{obsUrl}</p>
          <button
            onClick={() => {
              navigator.clipboard
                ?.writeText(obsUrl)
                .then(() => setCopiado(true))
                .catch(() => setCopiado(false));
            }}
          >
            {copiado ? "Copiado!" : "Copiar link do OBS"}
          </button>
          <span className="mesa-audio-note">
            Fonte de Navegador no OBS, 1920×1080, com fundo transparente.
          </span>
        </>
      ) : (
        <p className="mesa-audio-note" style={{ margin: 0 }}>
          Escolha um streamer para ver o link.
        </p>
      ),
    },
    {
      id: "atalhos",
      nome: "Atalhos",
      resumo: `${ATALHOS.length} teclas`,
      conteudo: (
        <dl className="mesa-atalhos">
          {ATALHOS.map((a) => (
            <div key={a.tecla} className="mesa-atalho">
              <dt>{a.tecla}</dt>
              <dd>{a.oque}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ];

  const configControls = (
    <>
      {/* Vai para o <body> por portal. Na tela cheia a barra de icones fica
          dentro de .canvas-toolbar, que tem backdrop-filter — e isso faz ela
          virar o bloco que contem ate os filhos `position: fixed`. Sem o
          portal, o menu ficava preso e cortado ali dentro, e o item da mesa
          por baixo e que recebia os cliques. */}
      {configAberto && montado && createPortal(
        <>
          {/* Fundo clicavel: fecha o menu e impede que a mesa receba clique
              enquanto ele esta aberto. */}
          <div className="mesa-config-fundo" onClick={() => setConfigAberto(false)} />
          <div
            className="mesa-config"
            role="dialog"
            aria-modal="true"
            aria-label="Configurações da mesa"
          >
            <div className="mesa-config-topo">
              <strong>Configurações</strong>
              <button
                className="mesa-config-fechar"
                onClick={() => setConfigAberto(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Um grupo por assunto: o titulo e o botao, e o conteudo so
                aparece no grupo aberto. Sao poucos por enquanto, mas assim
                cada ajuste novo entra no grupo dele em vez de alongar uma
                lista unica. */}
            {GRUPOS_CONFIG.map((g) => {
              const aberto = grupoAberto === g.id;
              return (
                <section key={g.id} className={`mesa-config-grupo${aberto ? " aberto" : ""}`}>
                  <h4>
                    <button
                      className="mesa-config-grupo-btn"
                      aria-expanded={aberto}
                      onClick={() => setGrupoAberto(aberto ? null : g.id)}
                    >
                      <span className="mesa-config-seta" aria-hidden="true">
                        {aberto ? "▾" : "▸"}
                      </span>
                      <span className="mesa-config-grupo-nome">{g.nome}</span>
                      <span className="mesa-config-grupo-resumo">{g.resumo}</span>
                    </button>
                  </h4>
                  {aberto && <div className="mesa-config-corpo">{g.conteudo}</div>}
                </section>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );

  const stage = (
      <div
        className="mesa-viewport"
        ref={viewportRef}
        onPointerDownCapture={onViewportPointerDown}
        onContextMenu={onViewportContextMenu}
      >
        <div
          ref={stageRef}
          className={`mesa-stage${altHeld ? " alt-remodelar" : ""}${grade ? " com-grade" : ""}`}
          style={
            {
              "--zoom": zoom,
              ...(bgMode === "ref" && bgUrl
                ? {
                    backgroundImage: `url(${bgUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : {}),
            } as React.CSSProperties
          }
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
        >
        {bgMode === "obs" && liveConfigured && (
          <StageBg src={buildObsViewUrl(cfg)} title="Tela do OBS ao vivo" />
        )}
        {bgMode === "twitch" && twitchSrc && (
          <StageBg src={twitchSrc} title="Transmissão da Twitch" />
        )}

        {items.map((it) => {
          const isSel = it.itemId === selectedId;
          const toolbar = (
            <div className="mesa-item-toolbar" onPointerDown={(e) => e.stopPropagation()}>
              <button
                className="mesa-grip"
                title="Arraste para mover"
                aria-label="Mover"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onItemPointerDown(e, it);
                }}
              >
                ✥
              </button>
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
                ref={(el) => {
                  if (el) boxEls.current.set(it.itemId, el);
                  else boxEls.current.delete(it.itemId);
                }}
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

          if (it.media.type === "TEXT" || it.media.type === "WIDGET") {
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
                <span className="mesa-text">
                  {it.media.type === "WIDGET" ? (
                    <WidgetView config={parseWidget(it.text)} />
                  ) : (
                    it.text
                  )}
                </span>
                {isSel &&
                  TEXT_HANDLES.map((h) => (
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

          if (it.media.type === "EMBED") {
            return (
              <div
                key={it.itemId}
                ref={(el) => {
                  if (el) boxEls.current.set(it.itemId, el);
                  else boxEls.current.delete(it.itemId);
                }}
                className={`mesa-item embed-item${it.scaleY != null ? " stretched" : ""}${isSel ? " selected" : ""}${it.hidden ? " hidden" : ""}`}
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
                {/* iframe com pointer-events:none (via CSS) para poder arrastar a caixa */}
                <iframe
                  className="mesa-embed"
                  src={it.media.url}
                  allow="autoplay; fullscreen; picture-in-picture"
                  title="Feed ao vivo"
                />
                <span className="mesa-embed-badge">Feed ao vivo</span>
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
      </div>
  );

  // Lista dos elementos que estao na mesa — painel flutuante do modo tela
  // cheia (mesmo espirito do painel "elements" do Pogly): clicar seleciona,
  // e cada linha tem mostrar/ocultar e remover. O numero a esquerda e o
  // atalho de teclado daquele item (1..9, 0).
  const elementsList = (
    <ul className="canvas-elements">
      {items.map((it, i) => {
        const name =
          it.media.type === "TEXT"
            ? it.text || "(texto vazio)"
            : it.media.type === "WIDGET"
            ? `⏱ ${WIDGET_LABEL[parseWidget(it.text).kind]}`
            : it.media.name || "(sem nome)";
        return (
          <li
            key={it.itemId}
            className={`canvas-el${it.itemId === selectedId ? " selected" : ""}${it.hidden ? " hidden" : ""}`}
          >
            <button
              className="canvas-el-pick"
              onClick={() => setSelectedId(it.itemId)}
              title="Selecionar na mesa"
            >
              <span className="canvas-el-key">{i < 9 ? i + 1 : i === 9 ? 0 : "·"}</span>
              <span className="canvas-el-name">
                {name}
              </span>
            </button>
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
          </li>
        );
      })}
      {items.length === 0 && <li className="canvas-empty">Nenhum elemento na mesa ainda.</li>}
    </ul>
  );

  // Tela exclusiva: o palco ocupa a tela toda e os controles viram paineis
  // flutuantes por cima, como no canvas do Pogly.
  if (fullscreen) {
    return (
      <div className="canvas-root">
        {stage}

        <aside className="canvas-panel canvas-panel-left">
          <h3 className="canvas-panel-title">elementos</h3>
          {elementsList}
          <h3 className="canvas-panel-title" style={{ marginTop: "1rem" }}>
            cenas
          </h3>
          {sceneControls}
        </aside>

        {/* So aparece quando ha um item com som selecionado; a engrenagem
            mudou para a barra de icones, junto das demais ferramentas. */}
        {audioControls && (
          <aside className="canvas-panel canvas-panel-right">
            <h3 className="canvas-panel-title">ajustes</h3>
            {audioControls}
          </aside>
        )}

        <div className="canvas-toolbar">{addControls}</div>
        {configControls}
      </div>
    );
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
      {addControls}
      {configControls}
      {sceneControls}
      {audioControls}
      {stage}
    </section>
  );
}
