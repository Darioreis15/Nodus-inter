import { PrismaClient } from '@prisma/client';
import { seal, unseal } from '../src/security/secrets';
const prisma = new PrismaClient();
async function main() {
  for (const channel of await prisma.channel.findMany({ where: { type: 'OFFICIAL_META' } })) {
    const config = channel.config as any;
    if (!config.accessToken) continue;
    if (config.accessToken.startsWith('enc:v1:')) { unseal(config.accessToken, `meta:${config.phoneNumberId}`); continue; }
    await prisma.channel.update({ where: { id: channel.id }, data: { config: { ...config, accessToken: seal(config.accessToken, `meta:${config.phoneNumberId}`) } } });
  }
  for (const hook of await prisma.webhookSubscription.findMany()) {
    if (hook.secret.startsWith('enc:v1:')) { unseal(hook.secret, `webhook:${hook.tenantId}`); continue; }
    await prisma.webhookSubscription.update({ where: { id: hook.id }, data: { secret: seal(hook.secret, `webhook:${hook.tenantId}`) } });
  }
  console.log('Segredos migrados/validados. Nenhum valor foi exibido.');
}
main().catch(() => { console.error('Migracao falhou. Verifique chave e conectividade.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
