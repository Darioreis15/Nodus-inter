import { Injectable, BadGatewayException } from '@nestjs/common';

/**
 * Cliente fino pra API do Asaas (v3). Autenticacao e via header
 * "access_token" (nao e Bearer) -- detalhe facil de errar.
 * https://docs.asaas.com/docs/autenticacao
 */
@Injectable()
export class AsaasClient {
  private get baseUrl(): string {
    return process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3';
  }

  private get apiKey(): string {
    const key = process.env.ASAAS_API_KEY;
    if (!key) {
      throw new BadGatewayException('ASAAS_API_KEY nao configurada.');
    }
    return key;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NodusWhatsappSaas/1.0',
        access_token: this.apiKey,
        ...(init?.headers ?? {}),
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadGatewayException(`Erro na API do Asaas: ${JSON.stringify(data)}`);
    }
    return data as T;
  }

  createCustomer(input: { name: string; cpfCnpj: string; email?: string }) {
    return this.request<{ id: string }>('/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  createSubscription(input: {
    customer: string;
    value: number;
    cycle: string;
    description: string;
    nextDueDate: string;
    billingType?: string;
  }) {
    return this.request<{ id: string }>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ billingType: 'UNDEFINED', ...input }),
    });
  }

  getSubscriptionPayments(subscriptionId: string) {
    return this.request<{ data: Array<{ id: string; invoiceUrl: string; status: string }> }>(
      `/subscriptions/${subscriptionId}/payments`,
    );
  }
}
