import { PrismaClient } from '@prisma/client';
import { AsaasClient } from '../src/billing/asaas.client';
import { EvolutionConnector } from '../src/channels/connectors/evolution.connector';
const prisma = new PrismaClient();
async function main() {
  const id = process.env.ERASE_TENANT_ID;
  if (!id) throw new Error('Informe ERASE_TENANT_ID.');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id }, include: { channels: true, subscription: true } });
  if (await prisma.contact.count({ where: { tenantId: id, legalHold: true } })) throw new Error('Retencao legal ativa.');
  if (process.env.CONFIRM_TENANT_ERASURE !== id) {
    console.log('Dry-run: tenant encontrado. Canais:', tenant.channels.length, 'Assinatura:', Boolean(tenant.subscription));
    return;
  }
  // Suspender primeiro evita novas operacoes de usuario. Pausar entrada no provedor antes do job.
  await prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });
  if (tenant.subscription) await new AsaasClient().cancelSubscription(tenant.subscription.asaasSubscriptionId);
  for (const channel of tenant.channels) {
    if (channel.type === 'QR_EVOLUTION') await new EvolutionConnector().deleteInstance((channel.config as any).instanceName);
  }
  await prisma.$transaction(async tx => {
    await tx.conversation.deleteMany({ where: { channel: { tenantId: id } } });
    await tx.contact.deleteMany({ where: { tenantId: id } });
    await tx.channel.deleteMany({ where: { tenantId: id } });
    await tx.apiKey.deleteMany({ where: { tenantId: id } });
    await tx.webhookSubscription.deleteMany({ where: { tenantId: id } });
    await tx.subscription.deleteMany({ where: { tenantId: id } });
    await tx.auditEvent.updateMany({ where: { tenantId: id }, data: { tenantId: null, actorId: null } });
    await tx.user.deleteMany({ where: { tenantId: id } });
    await tx.tenant.delete({ where: { id } });
    await tx.auditEvent.create({ data: { action: 'privacy.tenant.erase' } });
  });
  console.log('Dados locais excluidos. Concluir solicitacoes nos provedores e registro de exclusao para restauracoes de backup.');
}
main().catch(() => { console.error('Exclusao nao concluida; verificar conectividade, retencao e provedores. Nenhum segredo foi exibido.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
