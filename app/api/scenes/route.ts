import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { modSlug, streamerSlug } from "@/lib/accounts";
import { sanitizeSceneItems, MAX_SCENE_ITEMS } from "@/lib/scenes";
import { mensagemDeBanco, tabelaAusente } from "@/lib/db-errors";

// Cenas salvas: arranjos nomeados dos itens da mesa, por mod e por streamer.
// Salvar/aplicar e sempre no escopo do proprio mod (owner = quem esta logado),
// entao um mod nunca enxerga nem sobrescreve a cena de outro.
//
// Aplicar a cena NAO acontece aqui: quem aplica e a mesa, reusando as rotas ja
// existentes (/trigger/remove e /trigger/show), que ja cuidam do tempo real e
// da persistencia do overlay.

const MAX_NOME = 40;

// GET /api/scenes?streamer=<slug> — lista as cenas do mod neste streamer.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const streamer = streamerSlug(request.nextUrl.searchParams.get("streamer") || "");
  if (!streamer) {
    return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  }

  try {
    const rows = await prisma.scene.findMany({
      where: { streamer, owner },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    const scenes = rows.map((r) => ({
      id: r.id,
      name: r.name,
      count: Array.isArray(r.items) ? r.items.length : 0,
      updatedAt: r.updatedAt.toISOString(),
    }));
    return NextResponse.json({ scenes });
  } catch (err) {
    // Nao quebra o painel inteiro, mas tambem NAO finge que so nao ha cenas:
    // devolve o motivo para a UI poder avisar em vez de mostrar lista vazia.
    console.warn("[scenes] falha ao listar:", err instanceof Error ? err.message : err);
    return NextResponse.json({
      scenes: [],
      unavailable: true,
      reason: mensagemDeBanco(err, "As cenas salvas"),
    });
  }
}

// POST /api/scenes — salva (ou sobrescreve) uma cena com o arranjo atual.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as {
    streamer?: string;
    name?: string;
    items?: unknown;
  } | null;

  const streamer = streamerSlug(body?.streamer || "");
  if (!streamer) {
    return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  }
  const name = (body?.name || "").trim().slice(0, MAX_NOME);
  if (!name) {
    return NextResponse.json({ error: "Dê um nome para a cena" }, { status: 400 });
  }

  // Normaliza o snapshot: so os campos que a mesa sabe reconstruir, com os
  // numeros dentro dos limites. Assim uma cena nunca recria um item invalido.
  const items = sanitizeSceneItems(body?.items);
  if (items.length > MAX_SCENE_ITEMS) {
    return NextResponse.json(
      { error: `A cena tem itens demais (máximo ${MAX_SCENE_ITEMS}).` },
      { status: 400 }
    );
  }

  try {
    const saved = await prisma.scene.upsert({
      where: { streamer_owner_name: { streamer, owner, name } },
      update: { items },
      create: { streamer, owner, name, items },
    });
    return NextResponse.json({ ok: true, id: saved.id, name: saved.name, count: items.length });
  } catch (err) {
    const message = mensagemDeBanco(err, "As cenas salvas");
    console.error("[scenes] falha ao salvar:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: tabelaAusente(err) ? 503 : 500 });
  }
}

// DELETE /api/scenes — apaga uma cena do proprio mod.
export async function DELETE(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id e obrigatorio" }, { status: 400 });
  }

  try {
    // O filtro por owner garante que ninguem apague a cena de outro mod.
    await prisma.scene.deleteMany({ where: { id: body.id, owner } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: mensagemDeBanco(err, "As cenas salvas") },
      { status: tabelaAusente(err) ? 503 : 500 }
    );
  }
}
