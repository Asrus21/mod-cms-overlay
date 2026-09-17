// Emotes do canal: os da propria Twitch mais os das tres extensoes que a
// maioria dos canais usa (7TV, BetterTTV, FrankerFaceZ).
//
// Cada uma devolve um formato diferente e monta a URL da imagem de um jeito
// proprio. Aqui elas viram uma lista so, no mesmo formato, para o painel nao
// precisar saber de onde veio nada. Logica pura (sem rede) para poder ser
// conferida com respostas de verdade.

export type OrigemEmote = "twitch" | "7tv" | "bttv" | "ffz";

export type Emote = {
  id: string; // unico dentro da origem
  nome: string; // o que se digita no chat
  url: string; // imagem no maior tamanho disponivel
  origem: OrigemEmote;
  animado: boolean;
};

// Chave usada para nao repetir o mesmo emote duas vezes.
function chave(e: Emote): string {
  return `${e.origem}:${e.id}`;
}

function texto(v: unknown, max = 100): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// --- Twitch (Helix /chat/emotes) ---------------------------------------
// A resposta traz `images.url_4x` e um `template` para montar outras versoes.
// Emotes animados so aparecem animados pelo template com format=animated; o
// url_4x deles e o quadro parado.
export function dosEmotesTwitch(resposta: unknown): Emote[] {
  if (!resposta || typeof resposta !== "object") return [];
  const o = resposta as Record<string, unknown>;
  const template = texto(o.template, 300);
  const out: Emote[] = [];
  for (const bruto of lista(o.data)) {
    if (!bruto || typeof bruto !== "object") continue;
    const e = bruto as Record<string, unknown>;
    const id = texto(e.id, 64);
    const nome = texto(e.name);
    if (!id || !nome) continue;
    const animado = lista(e.format).includes("animated");
    let url = "";
    if (animado && template) {
      url = template
        .replace("{{id}}", id)
        .replace("{{format}}", "animated")
        .replace("{{theme_mode}}", "dark")
        .replace("{{scale}}", "3.0");
    }
    if (!url) {
      const imgs = (e.images || {}) as Record<string, unknown>;
      url = texto(imgs.url_4x, 400) || texto(imgs.url_2x, 400) || texto(imgs.url_1x, 400);
    }
    if (url) out.push({ id, nome, url, origem: "twitch", animado });
  }
  return out;
}

// --- 7TV (/v3/users/twitch/<id>) ---------------------------------------
// A URL vem sem protocolo em `data.host.url` e os tamanhos sao arquivos
// dentro dela ("4x.webp", "3x.webp"...).
export function dosEmotes7tv(resposta: unknown): Emote[] {
  if (!resposta || typeof resposta !== "object") return [];
  const conjunto = (resposta as Record<string, unknown>).emote_set;
  if (!conjunto || typeof conjunto !== "object") return [];
  const out: Emote[] = [];
  for (const bruto of lista((conjunto as Record<string, unknown>).emotes)) {
    if (!bruto || typeof bruto !== "object") continue;
    const e = bruto as Record<string, unknown>;
    const id = texto(e.id, 64);
    const nome = texto(e.name);
    const dados = (e.data || {}) as Record<string, unknown>;
    const host = (dados.host || {}) as Record<string, unknown>;
    const base = texto(host.url, 300);
    if (!id || !nome || !base) continue;
    // Escolhe o maior arquivo que a propria resposta anuncia.
    const arquivos = lista(host.files)
      .map((f) => (f && typeof f === "object" ? texto((f as Record<string, unknown>).name, 40) : ""))
      .filter((n) => n.endsWith(".webp"));
    const melhor =
      ["4x.webp", "3x.webp", "2x.webp", "1x.webp"].find((n) => arquivos.includes(n)) || "4x.webp";
    out.push({
      id,
      nome,
      url: `${comProtocolo(base)}/${melhor}`,
      origem: "7tv",
      animado: Boolean(dados.animated),
    });
  }
  return out;
}

// --- BetterTTV (/3/cached/users/twitch/<id>) ---------------------------
export function dosEmotesBttv(resposta: unknown): Emote[] {
  if (!resposta || typeof resposta !== "object") return [];
  const o = resposta as Record<string, unknown>;
  const out: Emote[] = [];
  // Emotes do canal e os "compartilhados" (adicionados de outros canais).
  for (const bruto of [...lista(o.channelEmotes), ...lista(o.sharedEmotes)]) {
    if (!bruto || typeof bruto !== "object") continue;
    const e = bruto as Record<string, unknown>;
    const id = texto(e.id, 64);
    const nome = texto(e.code);
    if (!id || !nome) continue;
    out.push({
      id,
      nome,
      url: `https://cdn.betterttv.net/emote/${id}/3x`,
      origem: "bttv",
      animado: Boolean(e.animated) || texto(e.imageType, 10) === "gif",
    });
  }
  return out;
}

// --- FrankerFaceZ (/v1/room/id/<id>) ----------------------------------
// Os emotes vem agrupados em "sets", e as URLs sao chaveadas pela escala.
export function dosEmotesFfz(resposta: unknown): Emote[] {
  if (!resposta || typeof resposta !== "object") return [];
  const sets = (resposta as Record<string, unknown>).sets;
  if (!sets || typeof sets !== "object") return [];
  const out: Emote[] = [];
  for (const conjunto of Object.values(sets as Record<string, unknown>)) {
    if (!conjunto || typeof conjunto !== "object") continue;
    for (const bruto of lista((conjunto as Record<string, unknown>).emoticons)) {
      if (!bruto || typeof bruto !== "object") continue;
      const e = bruto as Record<string, unknown>;
      const id = e.id === undefined || e.id === null ? "" : String(e.id).slice(0, 64);
      const nome = texto(e.name);
      if (!id || !nome) continue;
      const animado = Boolean(e.animated);
      // Um emote animado tem um conjunto de URLs proprio.
      const fonte = (animado && e.animated && typeof e.animated === "object"
        ? (e.animated as Record<string, unknown>)
        : (e.urls || {})) as Record<string, unknown>;
      const url = comProtocolo(
        texto(fonte["4"], 300) || texto(fonte["2"], 300) || texto(fonte["1"], 300)
      );
      if (url) out.push({ id, nome, url, origem: "ffz", animado });
    }
  }
  return out;
}

// As tres extensoes devolvem URL sem protocolo ("//cdn...").
function comProtocolo(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

// Junta tudo, sem repetidos, em ordem alfabetica pelo nome.
//
// O mesmo emote pode vir de mais de uma origem (um canal com 7TV e BTTV
// costuma ter repetidos de nome). Mantemos os dois — sao imagens diferentes —
// e so cortamos a repeticao de id dentro da MESMA origem.
export function juntarEmotes(...grupos: Emote[][]): Emote[] {
  const vistos = new Set<string>();
  const out: Emote[] = [];
  for (const grupo of grupos) {
    for (const e of grupo) {
      const k = chave(e);
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(e);
    }
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

// Filtro da busca do painel.
export function filtrarEmotes(emotes: Emote[], busca: string): Emote[] {
  const q = busca.trim().toLowerCase();
  if (!q) return emotes;
  return emotes.filter((e) => e.nome.toLowerCase().includes(q));
}
