export function sandboxBillingAvailable() {
  return process.env.BILLING_SANDBOX_TEST_ENABLED === 'true' &&
    process.env.ASAAS_BASE_URL === 'https://api-sandbox.asaas.com/v3';
}
