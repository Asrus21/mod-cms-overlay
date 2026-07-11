import { PrismaClient } from "@prisma/client";

// Evita recriar o PrismaClient a cada hot-reload em dev (esgota conexoes).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
