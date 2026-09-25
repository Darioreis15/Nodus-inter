import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const starter = await prisma.plan.upsert({
    where: { slug: 'starter' },
    update: { priceCents: 9900 },
    create: {
      name: 'Starter',
      slug: 'starter',
      maxChannels: 1,
      maxUsers: 3,
      priceCents: 9900, // R$ 99,00/mes
    },
  });

  await prisma.plan.upsert({
    where: { slug: 'pro' },
    update: { priceCents: 29900 },
    create: {
      name: 'Pro',
      slug: 'pro',
      maxChannels: 5,
      maxUsers: 15,
      priceCents: 29900, // R$ 299,00/mes
    },
  });

  const existingDemo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (!existingDemo) {
    const demoTenant = await prisma.tenant.create({
      data: {
        name: 'Empresa Demo',
        slug: 'demo',
        planId: starter.id,
      },
    });

    const passwordHash = await bcrypt.hash('trocar123', 10);
    await prisma.user.create({
      data: {
        tenantId: demoTenant.id,
        name: 'Admin Demo',
        email: 'admin@demo.nodus.dev',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
      },
    });

    console.log('Tenant demo criado: admin@demo.nodus.dev / trocar123 (troca obrigatoria no 1o login)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
