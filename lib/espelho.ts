// Redimensionar passando da borda oposta espelha o item.
//
// Ao arrastar um puxador, a largura (ou altura) e calculada a partir da borda
// que fica parada. Se o puxador cruza essa borda, a medida passa a ser
// negativa. Em vez de travar no tamanho minimo, como antes, o item cresce para
// o outro lado e a imagem vira — e o que editores de imagem fazem, e o que
// permite espelhar arrastando para cima, para baixo e para os lados.
//
// Logica pura, sem DOM, para poder ser conferida direto.

export type Medida = {
  tamanho: number; // sempre positivo, ja preso entre min e max
  invertido: boolean; // cruzou a borda parada (a medida veio negativa)
};

export function medidaComEspelho(comSinal: number, min: number, max: number): Medida {
  const invertido = comSinal < 0;
  const abs = Math.abs(comSinal);
  return { tamanho: Math.min(max, Math.max(min, Number.isFinite(abs) ? abs : min)), invertido };
}

// Espelho final: cruzar a borda inverte o estado em que o item estava quando o
// gesto comecou. Assim um item ja espelhado volta ao normal se cruzar de novo.
export function espelhoFinal(noInicio: boolean, cruzou: boolean): boolean {
  return noInicio !== cruzou;
}

// Centro do item com a borda `ancora` parada. `lado` e o sentido em que ele
// cresce a partir dela (+1 ou -1), ja invertido se cruzou.
export function centroAPartirDaAncora(ancora: number, lado: number, tamanho: number): number {
  return ancora + (lado * tamanho) / 2;
}
