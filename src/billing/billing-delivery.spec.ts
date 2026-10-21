import { BillingDelivery, safeBillingLink, verifiedPayment } from './billing-delivery';
import { billingReference } from './billing-calendar';
import * as bcrypt from 'bcryptjs';
describe('Billing delivery',()=>{
 const originalEnv=process.env;let prisma:any,asaas:any,conversations:any,service:BillingDelivery,row:any,sub:any,payment:any,fetchMock:jest.SpyInstance;
 beforeEach(()=>{
  process.env={...originalEnv,BILLING_DELIVERY_ENABLED:'true',PLATFORM_OWNER_USER_ID:'00000000-0000-4000-8000-000000000001',RESEND_API_KEY:'test',MAIL_FROM:'Nodus <billing@example.com>'};
  sub={id:'subscription',tenantId:'customer-tenant',asaasCustomerId:'cus',status:'ACTIVE',deliveryEnabled:true,cancellationPending:false,billingOptions:{},deliverySettings:{emailEnabled:true,whatsappEnabled:true,email:'finance@example.com',phone:'5531999999999',channelId:'channel',enabledAt:'2026-10-20T00:00:00Z'},tenant:{name:'Company'}};
  row={id:'delivery',kind:'EMAIL',state:'QUEUED',cycle:{id:'cycle',month:'2026-11',paymentId:'pay',dueDate:'2026-11-10',valueCents:9900,subscription:sub}};
  payment={id:'pay',customer:'cus',externalReference:billingReference(sub.id,'2026-11'),dueDate:'2026-11-10',value:99,status:'PENDING',invoiceUrl:'https://sandbox.asaas.com/i/test'};
  const actor={id:'00000000-0000-4000-8000-000000000001',role:'ADMIN',tenantId:'nodus',passwordHash:bcrypt.hashSync('correct',4),tokenVersion:1,mustChangePassword:false};
  prisma={billingDelivery:{findUnique:jest.fn(async()=>row),updateMany:jest.fn(async({where,data})=>{const states=where.state?.in||[where.state];if(states.includes(row.state)){Object.assign(row,data);return {count:1};}return {count:0};}),update:jest.fn(async({data})=>Object.assign(row,data)),findMany:jest.fn(async()=>[]),createMany:jest.fn()},billingCycle:{findMany:jest.fn(async()=>[])},subscription:{findUniqueOrThrow:jest.fn(async()=>sub),findUnique:jest.fn(async()=>sub),update:jest.fn()},user:{findUnique:jest.fn(async()=>actor)},channel:{findFirst:jest.fn(async()=>({id:'channel',tenantId:'nodus',type:'QR_EVOLUTION'}))},auditEvent:{create:jest.fn()},$queryRaw:jest.fn(),$transaction:jest.fn(async fn=>fn(prisma))};
  asaas={getPayment:jest.fn(async()=>payment),setCustomerNotifications:jest.fn()};conversations={start:jest.fn(async()=>({id:'conversation'})),sendMessage:jest.fn(async()=>({id:'message',externalId:'wamid'})),sendTemplate:jest.fn(async()=>({id:'message',externalId:'wamid'}))};
  service=new BillingDelivery(prisma,asaas,conversations);fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({id:'mail'})} as any);
 });
 afterEach(()=>{process.env=originalEnv;fetchMock.mockRestore();});
 it('accepts only HTTPS Asaas invoice links',()=>{expect(safeBillingLink(payment.invoiceUrl)).toBe(payment.invoiceUrl);for(const url of ['http://asaas.com/i/x','https://asaas.com.evil.test/x','https://user@asaas.com/i/x','http://127.0.0.1/','https://asaas.com:444/i/x'])expect(()=>safeBillingLink(url)).toThrow();});
 it('requires payment ownership, amount, reference and due date to match',()=>{for(const changed of [{customer:'other'},{value:1},{dueDate:'2027-01-10'},{externalReference:'other'},{id:'other'}])expect(()=>verifiedPayment({...payment,...changed},row.cycle,sub)).toThrow('PAYMENT_MISMATCH');});
 it('accepts an email once, with provider idempotency, and does not claim delivery',async()=>{await service.process(row.id);await service.process(row.id);expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][1]).toMatchObject({headers:expect.objectContaining({'Idempotency-Key':'nodus-billing-delivery'})});expect(row).toMatchObject({state:'SENT',providerId:'mail'});});
 it('sends WhatsApp via the Nodus tenant without starting a funnel timer',async()=>{row.kind='WHATSAPP';await service.process(row.id);expect(conversations.sendMessage).toHaveBeenCalledWith('nodus','conversation',expect.stringContaining(payment.invoiceUrl),false);expect(fetchMock).not.toHaveBeenCalled();});
 it('requires an approved configured template for Meta',async()=>{row.kind='WHATSAPP';prisma.channel.findFirst.mockResolvedValue({type:'OFFICIAL_META'});await service.process(row.id);expect(row.error).toBe('META_TEMPLATE_REQUIRED');expect(conversations.sendTemplate).not.toHaveBeenCalled();process.env.BILLING_WHATSAPP_TEMPLATE_NAME='monthly_bill';await service.process(row.id);expect(conversations.sendTemplate).toHaveBeenCalledWith('nodus','conversation',expect.objectContaining({name:'monthly_bill',parameters:['Company','R$ 99,00','10/11/2026',payment.invoiceUrl]}),false);});
 it.each(['RECEIVED','CONFIRMED','REFUNDED'])('skips invoices already %s',async status=>{payment.status=status;await service.process(row.id);expect(row.state).toBe('SKIPPED');expect(fetchMock).not.toHaveBeenCalled();});
 it('skips canceled contracts and blocks mismatched invoices',async()=>{sub.cancellationPending=true;await service.process(row.id);expect(fetchMock).not.toHaveBeenCalled();row.state='QUEUED';sub.cancellationPending=false;payment.customer='foreign';await service.process(row.id);expect(row.state).toBe('REVIEW');expect(fetchMock).not.toHaveBeenCalled();});
 it('requires review after a timeout and never retries it automatically',async()=>{fetchMock.mockRejectedValueOnce(new Error('timeout'));await service.process(row.id);await service.process(row.id);expect(row.state).toBe('REVIEW');expect(fetchMock).toHaveBeenCalledTimes(1);});
 it('does not send after losing a concurrent claim or settings change',async()=>{prisma.billingDelivery.updateMany.mockResolvedValue({count:0});await service.process(row.id);expect(fetchMock).not.toHaveBeenCalled();prisma.subscription.findUniqueOrThrow.mockResolvedValue({...sub,deliveryEnabled:false});await service.process(row.id);expect(fetchMock).not.toHaveBeenCalled();});
 it('does not enqueue or send while globally disabled',async()=>{process.env.BILLING_DELIVERY_ENABLED='false';expect(await service.run()).toEqual({enabled:false});expect(prisma.billingCycle.findMany).not.toHaveBeenCalled();});
 it('enqueues both kinds atomically and skips historical invoices',async()=>{prisma.billingCycle.findMany.mockResolvedValue([{id:'old',createdAt:new Date('2026-10-19'),subscription:sub},{id:'new',createdAt:new Date('2026-11-01'),subscription:sub}]);await service.run();expect(prisma.billingDelivery.createMany.mock.calls[0][0].data).toEqual(expect.arrayContaining([expect.objectContaining({kind:'EMAIL',state:'SKIPPED'}),expect.objectContaining({kind:'WHATSAPP',state:'SKIPPED'})]));expect(prisma.billingDelivery.createMany.mock.calls[1][0].data.every((r:any)=>r.state==='QUEUED')).toBe(true);});
 it('reauthenticates owner and rejects foreign sender channels',async()=>{const dto:any={emailEnabled:true,whatsappEnabled:true,email:'finance@example.com',phone:'5531999999999',channelId:'channel',billingType:'BOLETO',takeoverConfirmed:true,currentPassword:'wrong'};await expect(service.save('tenant','00000000-0000-4000-8000-000000000001',dto)).rejects.toThrow();expect(asaas.setCustomerNotifications).not.toHaveBeenCalled();dto.currentPassword='correct';prisma.channel.findFirst.mockResolvedValue(null);await expect(service.save('tenant','00000000-0000-4000-8000-000000000001',dto)).rejects.toThrow('propria Nodus');expect(asaas.setCustomerNotifications).not.toHaveBeenCalled();});
 it('disables Asaas notifications before enabling delivery and fails closed if Asaas fails',async()=>{const dto:any={emailEnabled:true,whatsappEnabled:false,email:'finance@example.com',billingType:'BOLETO',takeoverConfirmed:true,currentPassword:'correct'};asaas.setCustomerNotifications.mockRejectedValueOnce(new Error('offline'));await expect(service.save('tenant','00000000-0000-4000-8000-000000000001',dto)).rejects.toThrow();expect(prisma.subscription.update).not.toHaveBeenCalled();await service.save('tenant','00000000-0000-4000-8000-000000000001',dto);expect(asaas.setCustomerNotifications).toHaveBeenCalledWith('cus',true);expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({deliveryEnabled:true,billingOptions:{billingType:'BOLETO'}})}));});
 it('labels sandbox emails and blocks test delivery in production or over WhatsApp',async()=>{
  row.cycle.isTest=true;process.env.BILLING_SANDBOX_TEST_ENABLED='true';process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  await service.process(row.id);
  const sent=JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(sent.subject).toContain('[TESTE SANDBOX]');expect(sent.text).toContain('não efetue pagamento real');
  fetchMock.mockClear();row.state='QUEUED';process.env.ASAAS_BASE_URL='https://api.asaas.com/v3';
  await service.process(row.id);expect(row.state).toBe('SKIPPED');expect(fetchMock).not.toHaveBeenCalled();
  row.state='QUEUED';row.kind='WHATSAPP';process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  await service.process(row.id);expect(conversations.sendMessage).not.toHaveBeenCalled();
 });

 it('sends an explicitly authorized sandbox WhatsApp once without email',async()=>{
  row.kind='WHATSAPP';row.cycle.isTest=true;row.testTarget={phone:sub.deliverySettings.phone,channelId:sub.deliverySettings.channelId};
  process.env.BILLING_SANDBOX_TEST_ENABLED='true';process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  await Promise.all([service.process(row.id),service.process(row.id)]);
  await service.process(row.id);
  expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
  expect(conversations.sendMessage).toHaveBeenCalledWith('nodus','conversation',expect.stringContaining('não efetue pagamento real'),false);
  expect(fetchMock).not.toHaveBeenCalled();expect(row.state).toBe('SENT');
 });
 it('blocks a changed sandbox recipient and Meta test channel',async()=>{
  row.kind='WHATSAPP';row.cycle.isTest=true;row.testTarget={phone:'other',channelId:'channel'};
  process.env.BILLING_SANDBOX_TEST_ENABLED='true';process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  await service.process(row.id);expect(row.error).toBe('SANDBOX_TARGET_CHANGED');
  row.state='QUEUED';row.testTarget.phone=sub.deliverySettings.phone;
  prisma.channel.findFirst.mockResolvedValue({type:'OFFICIAL_META'});
  await service.process(row.id);expect(row.error).toBe('SANDBOX_EVOLUTION_ONLY');
  expect(conversations.sendMessage).not.toHaveBeenCalled();expect(conversations.sendTemplate).not.toHaveBeenCalled();
 });
 it('does not automatically repeat an uncertain WhatsApp send',async()=>{
  row.kind='WHATSAPP';row.cycle.isTest=true;row.testTarget={phone:sub.deliverySettings.phone,channelId:'channel'};
  process.env.BILLING_SANDBOX_TEST_ENABLED='true';process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  conversations.sendMessage.mockRejectedValueOnce(new Error('timeout'));
  await service.process(row.id);await service.process(row.id);
  expect(row.state).toBe('REVIEW');expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
 });

});
