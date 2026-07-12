import { NextRequest, NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";
import { uploadMediaFile } from "@/lib/storage";

// POST /api/media/upload — recebe o arquivo binario e repassa ao
// armazenamento de arquivos (secao 2.6), devolvendo a URL resultante.
// O registro na biblioteca (metadados) e criado em seguida via
// POST /api/media (secao 5, passos 2-3).
export async function POST(request: NextRequest) {
  const { response } = requireMod(request);
  if (response) return response;

  let file: FormDataEntryValue | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file");
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel ler o arquivo enviado" },
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  }

  try {
    const { url } = await uploadMediaFile(file);
    return NextResponse.json({ url });
  } catch (err) {
    // Devolve o motivo real (ex.: token do Blob ausente) para o painel exibir,
    // em vez de um generico "Falha no upload".
    const message = err instanceof Error ? err.message : "Falha no upload";
    console.error("Erro no upload:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
