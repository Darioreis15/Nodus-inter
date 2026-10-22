import { priceForMonth, providerBillingOptions } from './plan-pricing';
it('keeps the current month price and selects the last effective scheduled price',()=>{
 const options={billingType:'BOLETO',planPriceSchedule:[{month:'2026-11',priceCents:29900},{month:'2026-12',priceCents:9900}]};
 expect(priceForMonth(9900,options,'2026-10')).toBe(9900);
 expect(priceForMonth(9900,options,'2026-11')).toBe(29900);
 expect(priceForMonth(9900,options,'2027-01')).toBe(9900);
 expect(providerBillingOptions(options)).toEqual({billingType:'BOLETO'});
});
