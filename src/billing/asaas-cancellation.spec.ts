import { AsaasClient } from './asaas.client';
import { BillingController } from './billing.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../common/guards/roles.guard';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';

describe('Encerramento HTTP e provedor', () => {
  afterEach(() => jest.restoreAllMocks());
  it('envia INACTIVE, sem DELETE ou alteracao das cobrancas existentes', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ok:true,json:async()=>({id:'sub_123',status:'INACTIVE'})} as Response);
    await new AsaasClient().stopRecurrence('sub_123');
    expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/subscriptions/sub_123', expect.objectContaining({method:'PUT',body:JSON.stringify({status:'INACTIVE'})}));
  });
  it('nao aceita resposta sem confirmacao de inativacao', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ok:true,json:async()=>({id:'sub_123',status:'ACTIVE'})} as Response);
    await expect(new AsaasClient().stopRecurrence('sub_123')).rejects.toThrow();
  });
  it('protege rota com ADMIN e exige confirmacao explicita', () => {
    expect(Reflect.getMetadata('roles', BillingController.prototype.cancel)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(GUARDS_METADATA, BillingController.prototype.cancel)).toContain(RolesGuard);
    expect(validateSync(plainToInstance(CancelSubscriptionDto,{currentPassword:'abc',confirmation:'YES'})).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(CancelSubscriptionDto,{currentPassword:'abc',confirmation:'CANCEL'}))).toHaveLength(0);
  });
});
