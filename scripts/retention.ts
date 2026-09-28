import { PrismaClient } from '@prisma/client';
import { runRetention } from '../src/privacy/retention';

const prisma = new PrismaClient();
async function main() {
  const result = await runRetention(prisma, process.env);
  console.log(JSON.stringify(result, null, 2));
  if (result.mode === 'DRY_RUN') {
    console.log('Simulacao: nenhum dado alterado. Revise todas as contagens e a preservacao legal antes de definir APPLY_RETENTION=true.');
  }
}
main().catch(() => { console.error('Falha na retencao. Verifique os prazos e a conexao. Se estava em modo de aplicacao, operacoes anteriores podem ter sido concluidas.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
