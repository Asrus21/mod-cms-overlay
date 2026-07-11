import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { ActionType, MediaType, Prisma } from "@prisma/client";

// GET /api/media?tag=&type=&q= — biblioteca de midias (secao 2.1: busca e
// filtra por tag, tipo ou nome).
export async function GET(request: NextRequest) {
  const { response } = await requireMod();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");
  const type = searchParams.get("type");
  const q = searchParams.get("q");

  const where: Prisma.MediaWhereInput = {};
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
// armazenamento de arquivos (secao 5, passo 3).
export async function POST(request: NextRequest) {
  const { session, response } = await requireMod();
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
      createdById: session!.modId!,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: ActionType.UPLOAD,
      modId: session!.modId!,
      mediaId: media.id,
    },
  });

  return NextResponse.json({ media }, { status: 201 });
}
