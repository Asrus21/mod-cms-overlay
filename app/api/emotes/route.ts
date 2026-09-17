import { NextRequest, NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";
import { streamerSlug } from "@/lib/accounts";
import { getChannelEmotes, getUserIdByLogin } from "@/lib/twitch";
import {
  dosEmotes7tv,
  dosEmotesBttv,
  dosEmotesFfz,
  dosEmotesTwitch,
  juntarEmotes,
  type Emote,
  type OrigemEmote,
} from "@/lib/emotes";

// GET /api/emotes?streamer=<login> — emotes do canal: os da Twitch mais os do
// 7TV, BetterTTV e FrankerFaceZ.
//
// Roda no SERVIDOR, e nao no navegador, por dois motivos: os emotes da Twitch
// exigem um token de aplicativo (que nao pode sair daqui), e assim as quatro
// consultas viram uma resposta so, ja normalizada.
//
// Cada fonte e buscada em paralelo e falha SOZINHA: um canal sem 7TV, uma
// extensao fora do ar ou um 404 nao podem derrubar as outras tres. O que deu
// errado volta em `fontes`, para o painel poder dizer o que faltou em vez de
// mostrar uma lista curta sem explicacao.

export const dynamic = "force-dynamic";
// Os emotes de um canal mudam raramente; o cache evita quatro chamadas
// externas a cada vez que o painel abre a aba.
export const revalidate = 300;

const TEMPO_LIMITE_MS = 6000;

type Estado = { ok: boolean; total: number; erro?: string };

// Busca uma fonte sem deixar o erro escapar: devolve os emotes e o que houve.
async function fonte(
  nome: OrigemEmote,
  buscar: () => Promise<Emote[]>
): Promise<{ nome: OrigemEmote; emotes: Emote[]; estado: Estado }> {
  try {
    const emotes = await buscar();
    return { nome, emotes, estado: { ok: true, total: emotes.length } };
  } catch (err) {
    const erro = err instanceof Error ? err.message : "falhou";
    return { nome, emotes: [], estado: { ok: false, total: 0, erro } };
  }
}

// fetch com teto de tempo: uma extensao lenta nao pode segurar a resposta.
async function buscarJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate } });
    // 404 = o canal nao usa essa extensao. Nao e erro: e lista vazia.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: NextRequest) {
  const { response } = requireMod(request);
  if (response) return response;

  const login = streamerSlug(request.nextUrl.searchParams.get("streamer") || "");
  if (!login) {
    return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  }

  // Todas as fontes sao chaveadas pelo id numerico do canal, nao pelo login.
  let id: string | null = null;
  try {
    id = await getUserIdByLogin(login);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao consultar o canal" },
      { status: 502 }
    );
  }
  if (!id) {
    return NextResponse.json({ error: `Canal "${login}" nao encontrado na Twitch` }, { status: 404 });
  }

  const [twitch, setetv, bttv, ffz] = await Promise.all([
    fonte("twitch", async () => dosEmotesTwitch(await getChannelEmotes(id!))),
    fonte("7tv", async () => dosEmotes7tv(await buscarJson(`https://7tv.io/v3/users/twitch/${id}`))),
    fonte("bttv", async () =>
      dosEmotesBttv(await buscarJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`))
    ),
    fonte("ffz", async () =>
      dosEmotesFfz(await buscarJson(`https://api.frankerfacez.com/v1/room/id/${id}`))
    ),
  ]);

  const emotes = juntarEmotes(twitch.emotes, setetv.emotes, bttv.emotes, ffz.emotes);
  const fontes: Record<string, Estado> = {
    twitch: twitch.estado,
    "7tv": setetv.estado,
    bttv: bttv.estado,
    ffz: ffz.estado,
  };

  return NextResponse.json({ streamer: login, emotes, fontes });
}
