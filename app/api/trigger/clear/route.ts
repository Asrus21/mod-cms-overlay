import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { publishClear } from "@/lib/realtime";
import { ActionType } from "@prisma/client";

// POST /api/trigger/clear — cenario "limpar tela agora" (secao 4): sem
// parametros de conteudo, so autoriza, audita e publica o evento de
// limpeza (tipo distinto do de exibicao, secao 4 passo 4).
export async function POST() {
  const { session, response } = await requireMod();
  if (response) return response;

  await prisma.auditLog.create({
    data: {
      action: ActionType.CLEAR,
      modId: session!.modId!,
    },
  });

  await publishClear({ triggeredAt: Date.now() });

  return NextResponse.json({ ok: true });
}
