import { Prisma } from "@prisma/client";

// Biblioteca de midias PRIVADA POR USUARIO.
//
// Cada pessoa que loga tem a sua propria biblioteca: so ela ve, dispara e
// exclui o que ela mesma cadastrou. `Media.createdBy` guarda o login da Twitch
// do dono. O que uma pessoa cadastra nao aparece para mais ninguem — nem para
// outros mods do mesmo streamer, nem para o master.
//
// A comparacao ignora maiusculas/minusculas: midias cadastradas antes do login
// via Twitch podem ter o nome salvo com outra capitalizacao.

// Filtro do Prisma para "somente as midias deste usuario".
export function mediaOwnerFilter(login: string): Prisma.StringFilter {
  return { equals: login.trim().toLowerCase(), mode: "insensitive" };
}

// Esta midia pertence a este usuario?
export function isMediaOwner(createdBy: string, login: string): boolean {
  return createdBy.trim().toLowerCase() === login.trim().toLowerCase();
}
