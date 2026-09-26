import { UnauthorizedException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';

describe('WebhooksController Asaas', () => {
  const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
  let billing: any;
  let controller: WebhooksController;
  const payload = { event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_test' } };

  beforeEach(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-secret';
    billing = { handlePaymentEvent: jest.fn().mockResolvedValue({ ok: true }) };
    controller = new WebhooksController({} as any, billing);
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
  });

  it('aceita o header do Asaas e encaminha o evento', async () => {
    await expect(controller.handleAsaas('test-webhook-secret', undefined, payload))
      .resolves.toEqual({ ok: true });
    expect(billing.handlePaymentEvent).toHaveBeenCalledWith(payload.event, payload);
  });

  it('rejeita query legada quando nao ha header', () => {
    expect(() => controller.handleAsaas(undefined, 'test-webhook-secret', payload)).toThrow(UnauthorizedException);
    expect(billing.handlePaymentEvent).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'incorrect-token'])('rejeita token ausente ou invalido: %s', (token) => {
    expect(() => controller.handleAsaas(token, undefined, payload)).toThrow(UnauthorizedException);
    expect(billing.handlePaymentEvent).not.toHaveBeenCalled();
  });

  it('nao usa a query para contornar um header invalido', () => {
    expect(() => controller.handleAsaas('incorrect-token', 'test-webhook-secret', payload))
      .toThrow(UnauthorizedException);
    expect(billing.handlePaymentEvent).not.toHaveBeenCalled();
  });

  it('rejeita chamadas quando o segredo nao esta configurado', () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    expect(() => controller.handleAsaas(undefined, undefined, payload)).toThrow(UnauthorizedException);
    expect(billing.handlePaymentEvent).not.toHaveBeenCalled();
  });
});
