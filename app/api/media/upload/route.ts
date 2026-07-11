import { NextRequest, NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";
import { uploadMediaFile } from "@/lib/storage";

// POST /api/media/upload — recebe o arquivo binario e repassa ao
// armazenamento de arquivos (secao 2.6), devolvendo a URL resultante.
// O registro na biblioteca (metadados) e criado em seguida via
// POST /api/media (secao 5, passos 2-3).
export async function POST(request: NextRequest) {
  const { response } = await requireMod();
  if (response) return response;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  }

  const { url } = await uploadMediaFile(file);

  return NextResponse.json({ url });
}
