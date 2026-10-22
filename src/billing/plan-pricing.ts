export function priceForMonth(base: number | null, options: any, month: string): number {
  const changes = Array.isArray(options?.planPriceSchedule) ? options.planPriceSchedule : [];
  const latest = changes.filter((c:any)=>typeof c.month==='string' && /^\d{4}-\d{2}$/.test(c.month) && c.month<=month && Number.isSafeInteger(c.priceCents) && c.priceCents>=500)
    .sort((a:any,b:any)=>b.month.localeCompare(a.month))[0];
  return latest?.priceCents ?? base ?? 0;
}
export function providerBillingOptions(options: any) {
  const { planPriceSchedule, ...provider } = options || {};
  return provider;
}
