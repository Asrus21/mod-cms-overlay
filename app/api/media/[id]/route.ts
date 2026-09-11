import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { deleteMediaFile } from "@/lib/storage";
import { isMediaOwner } from "@/lib/media-access";

// DELETE /api/media/<id> — exclui uma midia da biblioteca: apaga o registro,
// o binario no Blob e qualquer estado de overlay que a referencie (para nao
// reaparecer ao recarregar). Protegido por sessao de mod.
//
// A biblioteca e privada por usuario: so o DONO da midia pode exclui-la. Para
// qualquer outro ela simplesmente nao existe (404, sem revelar que existe).
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const id = params.id;
  const media = await prisma.media.findUnique({ where: { id } });
  if (!media || !isMediaOwner(media.createdBy, session.name)) {
    return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
  }

  // Remove do estado persistido do overlay (best-effort) para nao ressurgir.
  try {
    await prisma.overlayState.deleteMany({ where: { mediaId: id } });
  } catch {
    // best-effort
  }

  await prisma.media.delete({ where: { id } });
  await deleteMediaFile(media.url);

  return NextResponse.json({ ok: true });
}
