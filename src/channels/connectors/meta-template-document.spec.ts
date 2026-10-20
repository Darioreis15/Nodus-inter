import { MetaConnector } from './meta.connector';
import { seal } from '../../security/secrets';
const channel:any={config:{phoneNumberId:'123',accessToken:seal('secret','meta:123')}};
describe('Meta template document header',()=>{
 const original=global.fetch;
 afterEach(()=>global.fetch=original);
 it('uploads PDF and sends one template containing header and body parameters',async()=>{
  const fetch=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>({id:'456'})}).mockResolvedValueOnce({ok:true,json:async()=>({messages:[{id:'wamid'}]})});global.fetch=fetch;
  const result=await new MetaConnector().sendTemplate(channel,'5531999999999',{name:'boleto',language:'pt_BR',parameters:['Cliente','99,00']},{buffer:Buffer.from('%PDF-1.7'),mimetype:'application/pdf',originalname:'boleto.pdf'});
  expect(result).toEqual({externalId:'wamid',providerId:'456'});
  const body=JSON.parse(fetch.mock.calls[1][1].body);
  expect(body.template.components).toEqual([{type:'header',parameters:[{type:'document',document:{id:'456',filename:'boleto.pdf'}}]},{type:'body',parameters:[{type:'text',text:'Cliente'},{type:'text',text:'99,00'}]}]);
  expect(fetch).toHaveBeenCalledTimes(2);expect(body.type).toBe('template');
 });
 it('never submits a message if PDF upload failed',async()=>{
  const fetch=jest.fn().mockRejectedValue(new Error('timeout'));global.fetch=fetch;
  await expect(new MetaConnector().sendTemplate(channel,'55',{name:'boleto',language:'pt_BR',parameters:[]},{buffer:Buffer.from('%PDF-1.7'),mimetype:'application/pdf',originalname:'boleto.pdf'})).rejects.toMatchObject({response:expect.objectContaining({phase:'UPLOAD'})});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('preserves existing JSON text-only templates',async()=>{
  const fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({messages:[{id:'wamid'}]})});global.fetch=fetch;
  await new MetaConnector().sendTemplate(channel,'55',{name:'hello_world',language:'en_US',parameters:[]});
  expect(JSON.parse(fetch.mock.calls[0][1].body).template).toEqual({name:'hello_world',language:{code:'en_US'}});
 });
});
