/** @type {import('next').NextConfig} */
// assetPrefix: quando este app e servido ATRAS do hub asrus.app (via rewrite),
// o HTML referencia /_next/* que, sem prefixo, o navegador buscaria em
// asrus.app/_next/* — onde estao os assets do HUB, nao os deste app (404, pagina
// quebrada). Definindo NEXT_PUBLIC_ASSET_PREFIX com a URL de producao DESTE
// projeto (ex.: https://mod-cms-overlay.vercel.app), os assets carregam do
// dominio certo, funcionando tanto no acesso direto quanto pelo proxy do
// asrus.app. Sem a variavel, nada muda (acesso direto continua igual).
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX || undefined;

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  assetPrefix,
};

module.exports = nextConfig;
