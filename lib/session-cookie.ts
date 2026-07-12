// Constantes de cookie isoladas do modulo que usa `crypto` (Node), para o
// middleware (Edge Runtime) poder importar o nome do cookie sem arrastar o
// crypto para o bundle do edge.
export const SESSION_COOKIE = "mod_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias
