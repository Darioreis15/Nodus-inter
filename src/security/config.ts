import { clientIpSource } from './client-ip';

export function jwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32 || /troque|changeme/i.test(value)) {
    throw new Error('JWT_SECRET deve conter ao menos 32 caracteres aleatorios.');
  }
  return value;
}

export function validateSecurityConfig() {
  jwtSecret();
  if (clientIpSource() === 'render-true-client-ip' && process.env.TRUSTED_PROXY_CIDRS?.trim()) {
    throw new Error('Remova TRUSTED_PROXY_CIDRS ao usar CLIENT_IP_SOURCE=render-true-client-ip.');
  }
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DATA_ENCRYPTION_KEY || '')) {
    throw new Error('DATA_ENCRYPTION_KEY deve ser uma chave hexadecimal de 32 bytes.');
  }
  for (const name of ['META_APP_SECRET', 'EVOLUTION_WEBHOOK_TOKEN', 'ASAAS_WEBHOOK_TOKEN']) {
    if ((process.env[name] || '').length < 16) throw new Error(`${name} ausente ou muito curto.`);
  }
  if (!process.env.CORS_ORIGINS) throw new Error('Configure CORS_ORIGINS com origens HTTPS permitidas.');
}
