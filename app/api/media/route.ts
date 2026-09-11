import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { mediaOwnerFilter } from "@/lib/media-access";
import { ActionType, MediaType, Prisma } from "@prisma/client";

// GET /api/media?tag=&type=&q= — biblioteca de midias (secao 2.1: busca e
// filtra por tag, tipo ou nome).
//
// A biblioteca e PRIVADA: devolve SOMENTE as midias do usuario logado. O que
// uma pessoa cadastra nao aparece para nenhuma outra (nem para o master).
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");
  const type = searchParams.get("type");
  const q = searchParams.get("q");

  // Recorte por dono: cada usuario so enxerga a propria biblioteca.
  const where: Prisma.MediaWhereInput = { createdBy: mediaOwnerFilter(session.name) };
  if (tag) where.tags = { has: tag };
  if (type && Object.values(MediaType).includes(type as MediaType)) {
    where.type = type as MediaType;
  }
  if (q) where.name = { contains: q, mode: "insensitive" };

  const media = await prisma.media.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ media });
}

// POST /api/media — cadastra o registro apos o upload direto ao
// armazenamento de arquivos (secao 5, passo 3). A midia fica na biblioteca
// privada de quem cadastrou (`createdBy` = login da Twitch dele).
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json()) as {
    name?: string;
    type?: string;
    url?: string;
    tags?: string[];
  };

  if (!body.name || !body.url || !body.type) {
    return NextResponse.json({ error: "name, type e url sao obrigatorios" }, { status: 400 });
  }
  if (!Object.values(MediaType).includes(body.type as MediaType)) {
    return NextResponse.json({ error: "type invalido" }, { status: 400 });
  }

  const media = await prisma.media.create({
    data: {
      name: body.name,
      type: body.type as MediaType,
      url: body.url,
      tags: body.tags ?? [],
      createdBy: session.name.trim().toLowerCase(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: ActionType.UPLOAD,
      actor: session.name,
      mediaId: media.id,
      mediaName: media.name,
    },
  });

  return NextResponse.json({ media }, { status: 201 });
}
