// Que tipo de midia e este arquivo?
//
// A regra vive aqui (pura, sem DOM) porque agora ha dois lugares que enviam
// arquivo — o formulario do painel e a barra de insercao da mesa — e os dois
// precisam classificar igual. Se divergissem, o mesmo gif viraria GIF num
// lugar e IMAGE no outro, e o overlay trataria cada um de um jeito.

export type TipoMidia = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

// Extensoes usadas quando o navegador nao informa o MIME. Acontece de verdade:
// alguns sistemas devolvem file.type vazio, e ai so sobra o nome do arquivo.
const POR_EXTENSAO: Record<string, TipoMidia> = {
  gif: "GIF",
  apng: "GIF",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
  avif: "IMAGE",
  bmp: "IMAGE",
  svg: "IMAGE",
  mp4: "VIDEO",
  webm: "VIDEO",
  mov: "VIDEO",
  mkv: "VIDEO",
  m4v: "VIDEO",
  mp3: "AUDIO",
  ogg: "AUDIO",
  oga: "AUDIO",
  wav: "AUDIO",
  m4a: "AUDIO",
  flac: "AUDIO",
  opus: "AUDIO",
};

export function tipoDoArquivo(mime: string, nome: string): TipoMidia {
  const m = (mime || "").toLowerCase();
  // GIF antes de image/*: e imagem, mas o overlay o trata a parte.
  if (m === "image/gif" || m === "image/apng") return "GIF";
  if (m.startsWith("video/")) return "VIDEO";
  if (m.startsWith("audio/")) return "AUDIO";
  if (m.startsWith("image/")) return "IMAGE";

  const ext = (nome || "").toLowerCase().split(".").pop() || "";
  return POR_EXTENSAO[ext] ?? "IMAGE";
}

// Nome sugerido: o do arquivo, sem a extensao.
export function nomeDoArquivo(nome: string): string {
  return (nome || "").replace(/\.[^.]+$/, "").slice(0, 80);
}
