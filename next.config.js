/** @type {import('next').NextConfig} */
// Este app tambem e servido ATRAS do hub asrus.app (rewrite). Sem ajuste, o HTML
// referencia /_next/* que o navegador buscaria em asrus.app/_next/* — onde estao
// os assets do HUB, nao os deste app: o hub devolve HTML (404) e o navegador
// quebra com "Unexpected token '<'" (recebeu HTML onde esperava JS).
//
// Solucao MESMA-ORIGEM: os assets ganham um prefixo de caminho proprio
// (/painel-assets/...). O asrus.app encaminha /painel-assets/* para este projeto
// (rewrite no asrus-app), e aqui um rewrite interno mapeia /painel-assets/_next/*
// de volta para /_next/*. Assim os assets carregam sempre da origem que serviu a
// pagina (asrus.app quando vem pelo proxy; o dominio direto caso contrario), sem
// cross-origin/CORS e sem depender de env var.
const ASSET_PREFIX = "/painel-assets";

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  assetPrefix: ASSET_PREFIX,
  async rewrites() {
    return [
      // Serve os assets deste app tambem sob o prefixo usado no HTML.
      { source: `${ASSET_PREFIX}/_next/:path*`, destination: "/_next/:path*" },
    ];
  },
};

module.exports = nextConfig;
