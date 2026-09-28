import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

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

  if (process.env.CREATE_DEMO !== 'true') return;
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 16) throw new Error('Configure DEMO_PASSWORD forte.');
  const existingDemo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (!existingDemo) {
    const demoTenant = await prisma.tenant.create({
      data: {
        name: 'Empresa Demo',
        slug: 'demo',
        planId: starter.id,
      },
    });

    const passwordHash = await bcrypt.hash(demoPassword, 12);
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

    console.log('Tenant demo criado com troca obrigatoria de senha.');
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
