import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishClear } from "@/lib/realtime";
import { ActionType } from "@prisma/client";

// POST /api/trigger/clear — cenario "limpar tela agora" (secao 4): sem
// parametros de conteudo, so autoriza, audita e publica o evento de
// limpeza (tipo distinto do de exibicao, secao 4 passo 4).
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  try {
    await publishClear({ triggeredAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao limpar overlay";
    console.error("Erro no clear:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await prisma.auditLog.create({
    data: {
      action: ActionType.CLEAR,
      actor: session.name,
    },
  });

  return NextResponse.json({ ok: true });
}
