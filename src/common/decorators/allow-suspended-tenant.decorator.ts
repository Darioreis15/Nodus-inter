import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_TENANT = 'allowSuspendedTenant';
// Excecao restrita a consulta de cobranca; nao dispensa autenticacao.
export const AllowSuspendedTenant = () => SetMetadata(ALLOW_SUSPENDED_TENANT, true);
