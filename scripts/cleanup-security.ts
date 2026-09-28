import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  await db.rateBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.providerEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
}
main().catch(() => { console.error('Falha na limpeza de contadores.'); process.exitCode = 1; }).finally(() => db.$disconnect());
