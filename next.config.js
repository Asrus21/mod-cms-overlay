/** @type {import('next').NextConfig} */
// assetPrefix: quando este app e servido ATRAS do hub asrus.app (via rewrite),
// o HTML referencia /_next/* que, sem prefixo, o navegador buscaria em
// asrus.app/_next/* — onde estao os assets do HUB, nao os deste app (404, pagina
// em branco). Com o prefixo apontando para a URL de producao DESTE projeto, os
// assets carregam do dominio certo, funcionando tanto no acesso direto quanto
// pelo proxy do asrus.app.
//
// So aplicamos em PRODUCAO (VERCEL_ENV === "production"): assim os deployments
// de PREVIEW (mod-cms-overlay-git-*.vercel.app) continuam servindo os proprios
// assets (mesma origem) — se apontassem para producao, os hashes nao batem e o
// preview quebraria. Da para sobrescrever a URL com NEXT_PUBLIC_ASSET_PREFIX.
const PROD_URL = "https://mod-cms-overlay.vercel.app";
const assetPrefix =
  process.env.NEXT_PUBLIC_ASSET_PREFIX ||
  (process.env.VERCEL_ENV === "production" ? PROD_URL : undefined);

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  assetPrefix,
};

module.exports = nextConfig;
