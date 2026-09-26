import { Prisma, PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const days = Number(process.env.MESSAGE_RETENTION_DAYS);
  const auditDays = Number(process.env.AUDIT_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(auditDays) || auditDays < 1) throw new Error('Defina prazos de retencao aprovados, em dias.');
  if (process.env.APPLY_RETENTION !== 'true') {
    console.log('Dry-run:', await prisma.message.count({ where: { conversation: { contact: { legalHold: false } }, createdAt: { lt: new Date(Date.now() - days * 86400000) } } }), 'mensagens elegiveis. Para executar: APPLY_RETENTION=true.');
    return;
  }
  // Operador deve excluir do job bases sob retencao legal; ver SECURITY.md.
  await prisma.message.deleteMany({ where: { conversation: { contact: { legalHold: false } }, createdAt: { lt: new Date(Date.now() - days * 86400000) } } });
  await prisma.message.updateMany({ where: { conversation: { contact: { legalHold: false } } }, data: { raw: Prisma.DbNull } });
  await prisma.rateBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.providerEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
  await prisma.auditEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - auditDays * 86400000) } } });
}
main().catch(() => { console.error('Falha na retencao.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
