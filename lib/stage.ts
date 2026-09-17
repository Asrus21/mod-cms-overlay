// Limites de posicao de um item na tela.
//
// A posicao e normalizada: 0 = borda esquerda/topo, 1 = direita/base. Itens
// podem ser estacionados FORA da area visivel para entrarem e sairem da live
// deslizando, sem precisar remover e recolocar. O overlay corta o que passa da
// tela (.overlay-root tem overflow:hidden), entao um item em x = 1.4 fica
// invisivel para quem assiste, mas continua na mesa.
//
// O alcance e limitado para ninguem "perder" um item a quilometros da tela.
// ATENCAO: o cliente (Mesa.tsx) e as rotas /trigger/move e /trigger/show usam
// os MESMOS limites daqui — se mudar, muda para todos de uma vez.
// Meia tela alem de cada borda. Precisa ser generoso porque o item e
// centralizado na sua posicao: para SUMIR de vez, o centro tem de ir alem da
// borda somado a metade da largura dele (x >= 1 + largura/2). Com 0.5 ate um
// item do tamanho da tela inteira some por completo.
//
// Este numero anda junto com o padding de .mesa-viewport no globals.css: a
// margem visivel precisa cobrir todo este alcance, senao o mod nao consegue
// agarrar de volta o que estacionou.
export const OFFSTAGE = 0.5;
export const MIN_POS = -OFFSTAGE;
export const MAX_POS = 1 + OFFSTAGE;

export function clampPos(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  return Math.min(MAX_POS, Math.max(MIN_POS, v));
}
