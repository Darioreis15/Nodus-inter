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
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NodusWhatsappSaas/1.0',
        access_token: this.apiKey,
        ...(init?.headers ?? {}),
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadGatewayException(`Erro na API do Asaas: HTTP ${response.status}`);
    }
    return data as T;
  }

  getSubscription(id: string) {
    return this.request<any>(`/subscriptions/${encodeURIComponent(id)}`);
  }

  getPayment(id: string) {
    return this.request<CalendarPayment>(`/payments/${encodeURIComponent(id)}`);
  }

  async allPayments(filters: Record<string, string>) {
    const payments: CalendarPayment[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const query = new URLSearchParams({ ...filters, limit: '100', offset: String(offset) });
      const page = await this.request<{ data: CalendarPayment[]; hasMore: boolean }>(`/payments?${query}`);
      if (!page || !Array.isArray(page.data)) throw new BadGatewayException('Lista de cobrancas invalida.');
      payments.push(...page.data);
      if (!page.hasMore) return payments;
    }
    throw new BadGatewayException('Excesso de cobrancas para conciliacao automatica.');
  }

  createCalendarPayment(input: Record<string, unknown>) {
    return this.request<CalendarPayment>('/payments', { method: 'POST', body: JSON.stringify(input) });
  }

  listCustomerPayments(customerId: string, offset: number) {
    return this.request<{ data: Array<{ id: string; value: number; status: string; dueDate: string; paymentDate?: string; invoiceUrl?: string; description?: string }>; hasMore: boolean; totalCount: number }>(
      `/payments?customer=${encodeURIComponent(customerId)}&limit=50&offset=${offset}`,
    );
  }

  async stopRecurrence(id: string): Promise<void> {
    const result = await this.request<{ id: string; status: string }>(
      `/subscriptions/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify({ status: 'INACTIVE' }) },
    );
    if (!result || result.id !== id || result.status !== 'INACTIVE') {
      throw new BadGatewayException('Asaas nao confirmou a interrupcao da recorrencia.');
    }
  }

  cancelSubscription(id: string) {
    return this.request(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  getSubscriptionPayments(subscriptionId: string, status?: string) {
    return this.request<{ data: Array<{ id: string; invoiceUrl: string; status: string }> }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=1${status ? `&status=${encodeURIComponent(status)}` : ""}`,
    );
  }
}

export interface CalendarPayment {
  id: string; customer: string; subscription?: string; externalReference?: string;
  dueDate: string; value: number; status: string; invoiceUrl?: string; deleted?: boolean;
}
