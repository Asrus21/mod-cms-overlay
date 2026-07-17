export default function Home() {
  return (
    <main className="landing">
      <div className="landing-card">
        <span className="landing-kicker">Overlay para lives</span>
        <h1>Mod CMS Overlay</h1>
        <p className="landing-lead">
          Seus moderadores colocam <strong>imagens, gifs, vídeos, áudios e textos</strong>{" "}
          na tela da live — arrastando e ajustando com o mouse — e tudo aparece{" "}
          <strong>em tempo real</strong> no OBS do streamer.
        </p>

        <ol className="landing-steps">
          <li>
            <span className="landing-step-n">1</span>
            <span>
              <strong>Entre no painel</strong> com seu login de mod e escolha o
              streamer que você atende.
            </span>
          </li>
          <li>
            <span className="landing-step-n">2</span>
            <span>
              <strong>Coloque mídias na mesa</strong> e posicione com o mouse.
              Clique no <strong>👁</strong> para mostrar no overlay.
            </span>
          </li>
          <li>
            <span className="landing-step-n">3</span>
            <span>
              O streamer adiciona <strong>um único link</strong> como Browser
              Source no OBS — e vê tudo ao vivo.
            </span>
          </li>
        </ol>

        <a className="btn" href="/mod/painelMod">
          Entrar no painel →
        </a>
        <p className="landing-foot">
          É moderador? Peça seu login ao streamer. O overlay do OBS é gerado
          dentro do painel.
        </p>
      </div>
    </main>
  );
}
