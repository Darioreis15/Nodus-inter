import { PublicTemplatesService } from './public-templates.service';
const pdf={buffer:Buffer.from('%PDF-1.7'),size:8,mimetype:'application/pdf',originalname:'fatura.pdf'};
const dto={name:'fatura',language:'pt_BR',parameters:['Cliente']};
describe('Immediate template idempotency',()=>{
 function setup(){
  const rows=new Map<string,any>();const sendTemplate=jest.fn().mockResolvedValue({id:'m',status:'SENT'});
  const prisma:any={publicAttachmentRequest:{
   create:jest.fn(({data})=>{if(rows.has(data.keyHash))throw {code:'P2002'};const r={...data,id:data.keyHash,state:'SENDING'};rows.set(r.id,r);return r;}),
   findUniqueOrThrow:jest.fn(({where})=>rows.get(where.tenantId_keyHash.keyHash)),
   update:jest.fn(({where,data})=>Object.assign(rows.get(where.id),data)),
   updateMany:jest.fn(({where,data})=>Object.assign(rows.get(where.id),data)),
  }};
  return {rows,sendTemplate,service:new PublicTemplatesService(prisma,{sendTemplate} as any)};
 }
 it('replays the same receipt and never repeats the provider call',async()=>{
  const {service,sendTemplate}=setup();const a=await service.send('t','c',dto,'fatura-123',pdf),b=await service.send('t','c',dto,'fatura-123',pdf);
  expect(a).toEqual(b);expect(sendTemplate).toHaveBeenCalledTimes(1);
  await expect(service.send('t','c',{...dto,parameters:['Outro']},'fatura-123',pdf)).rejects.toMatchObject({status:409});
 });
 it('requires a key with a PDF and rejects non-PDF before reserving',async()=>{
  const {service,rows,sendTemplate}=setup();await expect(service.send('t','c',dto,undefined,pdf)).rejects.toMatchObject({status:400});
  await expect(service.send('t','c',dto,'fatura-123',{...pdf,mimetype:'application/vnd.ms-excel'})).rejects.toMatchObject({status:415});
  expect(rows.size).toBe(0);expect(sendTemplate).not.toHaveBeenCalled();
 });
 it('holds uncertain results for review',async()=>{
  const {service,sendTemplate,rows}=setup();sendTemplate.mockRejectedValueOnce(new Error('timeout'));
  await expect(service.send('t','c',dto,'fatura-123',pdf)).rejects.toThrow('timeout');
  await expect(service.send('t','c',dto,'fatura-123',pdf)).rejects.toMatchObject({status:409});
  expect([...rows.values()][0].state).toBe('REVIEW');expect(sendTemplate).toHaveBeenCalledTimes(1);
 });
});
