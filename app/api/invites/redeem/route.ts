import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { motivoDeRecusa, normalizarCodigo } from "@/lib/invites";
import { mensagemDeBanco, tabelaAusente } from "@/lib/db-errors";

// POST /api/invites/redeem — usa um codigo e ganha acesso a mesa daquele
// streamer. body: { code }
//
// Nao exige nada alem de estar logado: e exatamente esse o ponto do convite —
// quem recebe o codigo nem precisa ser mod do canal.
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = normalizarCodigo(body?.code || "");
  if (!code) {
    return NextResponse.json(
      { error: "Código incompleto. Ele tem 12 letras, no formato XXXX-XXXX-XXXX." },
      { status: 400 }
    );
  }

  const quemUsa = session.name.trim().toLowerCase();

  try {
    const convite = await prisma.mesaInvite.findUnique({ where: { code } });
    const recusa = motivoDeRecusa(convite, quemUsa);
    if (recusa) {
      // 404 so quando o codigo nao existe; o resto e o codigo existir e nao
      // servir para esta pessoa.
      return NextResponse.json({ error: recusa }, { status: convite ? 409 : 404 });
    }
    // O `!` e seguro: motivoDeRecusa devolve mensagem quando convite e nulo.
    const c = convite!;

    if (c.streamer === quemUsa) {
      return NextResponse.json({ error: "Esta já é a sua própria mesa." }, { status: 400 });
    }

    // Marca o codigo como usado ANTES de conceder, e so se ele ainda estiver
    // livre: duas pessoas digitando o mesmo codigo ao mesmo tempo nao podem
    // passar as duas. `updateMany` com usedBy vazio e a trava.
    const marcado = await prisma.mesaInvite.updateMany({
      where: { id: c.id, usedBy: "" },
      data: { usedBy: quemUsa, usedAt: new Date() },
    });
    if (marcado.count === 0) {
      return NextResponse.json({ error: "Este código já foi usado." }, { status: 409 });
    }

    await prisma.mesaAccess.upsert({
      where: { streamer_userLogin: { streamer: c.streamer, userLogin: quemUsa } },
      update: { streamerName: c.streamerName, grantedBy: c.createdBy },
      create: {
        streamer: c.streamer,
        streamerName: c.streamerName,
        userLogin: quemUsa,
        grantedBy: c.createdBy,
      },
    });

    return NextResponse.json({
      ok: true,
      streamer: c.streamer,
      streamerName: c.streamerName || c.streamer,
    });
  } catch (err) {
    console.error("[invites/redeem] falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: mensagemDeBanco(err, "Os convites") },
      { status: tabelaAusente(err) ? 503 : 500 }
    );
  }
}
