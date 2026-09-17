// Dominio canonico do projeto, usado para montar os links que vao para fora
// (o do overlay no OBS, o do player da Twitch).
//
// E fixo de proposito: o painel roda tanto em asrus.app (pelo hub) quanto no
// dominio do proprio projeto, em preview do Vercel, com e sem "www.". Montar o
// link a partir do endereco aberto no momento geraria um link diferente a cada
// caso — e o do OBS precisa bater exatamente com o "antigo"/limpo que os
// streamers ja tem colado la. Troque pela env NEXT_PUBLIC_PUBLIC_ORIGIN se o
// dominio canonico mudar.
export const PUBLIC_ORIGIN = (
  process.env.NEXT_PUBLIC_PUBLIC_ORIGIN || "https://asrus.app"
).replace(/\/+$/, "");
