import { put, del } from "@vercel/blob";

// Armazenamento de arquivos (secao 2.6). O binario vai direto para o Blob;
// o backend so recebe e persiste a URL resultante (secao 5).
export async function uploadMediaFile(file: File): Promise<{ url: string }> {
  // Erro claro quando a store Vercel Blob nao foi conectada ao projeto —
  // essa e a causa mais comum de "Falha no upload" num deploy novo.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Armazenamento nao configurado: crie uma store Vercel Blob no projeto (Storage -> Blob) e refaca o deploy para injetar BLOB_READ_WRITE_TOKEN."
    );
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await put(`media/${Date.now()}-${safeName}`, file, {
    access: "public",
  });
  return { url: blob.url };
}

// Apaga o binario do Blob (best-effort). Usado ao excluir uma midia da
// biblioteca. Nao falha se o token nao existir ou o arquivo ja tiver sumido.
export async function deleteMediaFile(url: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch {
    // best-effort: o registro ja foi removido; nao bloqueia por causa do blob.
  }
}
