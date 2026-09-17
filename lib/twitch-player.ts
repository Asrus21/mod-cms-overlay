// Transmissao da Twitch como item da mesa.
//
// O player da Twitch NAO aceita a qualidade pela URL: o embed lembra a ultima
// escolha no localStorage do dominio dele, e nao ha parametro para forcar.
// Quem consegue mandar e a API JS do embed (`player.setQuality(grupo)`), e ela
// so roda numa pagina NOSSA. Por isso o item aponta para /mod/player/twitch,
// que carrega o player e aplica a qualidade — e continua sendo um item do tipo
// EMBED, sem tabela nem tipo novo no banco.
//
// Logica pura (sem React nem DOM) para poder ser conferida direto.

export type QualidadeId = "480p30" | "720p30" | "720p60" | "1080p30" | "1080p60";

export const QUALIDADES: ReadonlyArray<{
  id: QualidadeId;
  altura: number;
  fps: number;
  rotulo: string;
}> = [
  { id: "480p30", altura: 480, fps: 30, rotulo: "480p" },
  { id: "720p30", altura: 720, fps: 30, rotulo: "720p 30fps" },
  { id: "720p60", altura: 720, fps: 60, rotulo: "720p 60fps" },
  { id: "1080p30", altura: 1080, fps: 30, rotulo: "1080p 30fps" },
  { id: "1080p60", altura: 1080, fps: 60, rotulo: "1080p 60fps" },
];

export const QUALIDADE_PADRAO: QualidadeId = "720p60";

export function isQualidade(v: unknown): v is QualidadeId {
  return typeof v === "string" && QUALIDADES.some((q) => q.id === v);
}

// Login da Twitch: 4-25 caracteres, letras/numeros/underscore.
const LOGIN = /^[a-zA-Z0-9_]{4,25}$/;

// Aceita o que o mod tiver em maos: "asrus", "@asrus", "twitch.tv/asrus" ou a
// URL inteira do canal. Devolve o login em minusculas, ou null se nao der.
export function canalDaEntrada(entrada: string): string | null {
  let v = entrada.trim();
  if (!v) return null;
  // Tira protocolo, dominio e o que vier depois do login (query, /videos, ...).
  v = v.replace(/^https?:\/\//i, "").replace(/^(www\.|m\.)/i, "");
  if (/^twitch\.tv\//i.test(v)) v = v.slice("twitch.tv/".length);
  v = v.replace(/^@/, "");
  v = v.split(/[/?#]/)[0];
  return LOGIN.test(v) ? v.toLowerCase() : null;
}

// Uma qualidade que o player anunciou para a transmissao atual.
export type QualidadeDisponivel = {
  group: string;
  height?: number | null;
  framerate?: number | null;
};

// Qual "group" mandar para o setQuality, dada a qualidade pedida pelo mod.
//
// A pedida pode simplesmente nao existir: um canal que transmite em 720p nao
// tem 1080p, e nem todo canal tem 60fps. Entao escolhemos a melhor que NAO
// passa do pedido (para o pedido valer como teto de banda) e, se nem isso
// existir, a menor disponivel. Entre alturas iguais, o fps mais perto do
// pedido — assim pedir 720p30 nao entrega 720p60.
export function escolherQualidade(
  desejada: QualidadeId,
  disponiveis: ReadonlyArray<QualidadeDisponivel>
): string | null {
  const alvo = QUALIDADES.find((q) => q.id === desejada);
  if (!alvo) return null;

  // "auto" e afins vem sem altura; nao servem para comparar.
  const reais = disponiveis.filter(
    (d) => typeof d.height === "number" && Number.isFinite(d.height) && (d.height as number) > 0
  ) as Array<QualidadeDisponivel & { height: number }>;
  if (reais.length === 0) return null;

  const cabem = reais.filter((d) => d.height <= alvo.altura);
  const menorAltura = Math.min(...reais.map((d) => d.height));
  const pool = cabem.length > 0 ? cabem : reais.filter((d) => d.height === menorAltura);

  const fpsDe = (d: QualidadeDisponivel) =>
    typeof d.framerate === "number" && Number.isFinite(d.framerate) ? Math.round(d.framerate) : 30;

  const ordenado = [...pool].sort((a, b) => {
    if (a.height !== b.height) return b.height - a.height; // maior altura primeiro
    const da = Math.abs(fpsDe(a) - alvo.fps);
    const db = Math.abs(fpsDe(b) - alvo.fps);
    if (da !== db) return da - db; // fps mais perto do pedido
    return fpsDe(a) - fpsDe(b); // empate: o mais leve
  });
  return ordenado[0].group;
}

// URL do item na mesa: a nossa pagina do player, que e quem aplica a qualidade.
// `origem` precisa ser absoluta (http/https) porque o item e um EMBED e a rota
// de disparo exige um link http(s).
export function urlDoPlayer(origem: string, canal: string, qualidade: QualidadeId): string {
  const base = origem.replace(/\/+$/, "");
  return `${base}/mod/player/twitch?canal=${encodeURIComponent(canal)}&q=${qualidade}`;
}
