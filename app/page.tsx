"use client";

import { motion, type Variants } from "framer-motion";
import { ThemeToggle } from "./ThemeToggle";

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

const features = [
  { icon: "🖼️", title: "Mídias na tela", desc: "Imagens, gifs, vídeos, áudios e textos." },
  { icon: "🖱️", title: "Mesa ao vivo", desc: "Arraste e ajuste com o mouse, em tempo real." },
  { icon: "📺", title: "Um link no OBS", desc: "O streamer usa só um Browser Source." },
  { icon: "🔴", title: "Feed ao vivo", desc: "Seu OBS entra no mesmo overlay." },
];

export default function Home() {
  return (
    <main className="landing">
      <ThemeToggle className="theme-toggle-fixed" />
      <div className="aurora" aria-hidden="true">
        <span className="aurora-blob b1" />
        <span className="aurora-blob b2" />
        <span className="aurora-blob b3" />
      </div>

      <motion.section
        className="landing-card"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.span className="landing-kicker" variants={item}>
          ⚡ Overlay em tempo real
        </motion.span>

        <motion.h1 className="landing-title" variants={item}>
          Mod CMS Overlay
        </motion.h1>

        <motion.p className="landing-lead" variants={item}>
          Seus moderadores colocam mídias na tela da live — arrastando e ajustando
          com o mouse — e tudo aparece <strong>ao vivo</strong> no OBS do streamer.
        </motion.p>

        <motion.div className="landing-features" variants={item}>
          {features.map((f) => (
            <motion.div
              className="landing-feature"
              key={f.title}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <span className="landing-feature-icon">{f.icon}</span>
              <div>
                <div className="landing-feature-title">{f.title}</div>
                <div className="landing-feature-desc">{f.desc}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.a
          className="landing-cta"
          href="/mod/painelMod"
          variants={item}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          Entrar no painel
          <span className="landing-cta-arrow" aria-hidden="true">→</span>
        </motion.a>

        <motion.p className="landing-foot" variants={item}>
          É moderador? Peça seu login ao streamer. O link do OBS é gerado dentro
          do painel.
        </motion.p>
      </motion.section>
    </main>
  );
}
