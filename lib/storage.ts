import { put } from "@vercel/blob";

// Armazenamento de arquivos (secao 2.6). O binario vai direto para o Blob;
// o backend so recebe e persiste a URL resultante (secao 5).
export async function uploadMediaFile(
  file: File
): Promise<{ url: string }> {
  const blob = await put(`media/${Date.now()}-${file.name}`, file, {
    access: "public",
  });
  return { url: blob.url };
}
