import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BillingDeliveryDto } from './billing-delivery';
describe('Financial WhatsApp phone input',()=>{
 const make=(phone:any)=>plainToInstance(BillingDeliveryDto,{emailEnabled:false,whatsappEnabled:true,phone,channelId:'00000000-0000-4000-8000-000000000001',billingType:'BOLETO',takeoverConfirmed:true,currentPassword:'test'});
 it.each([
  ['31988887777','5531988887777'],['(31) 98888-7777','5531988887777'],['3133334444','553133334444'],
  ['5531988887777','5531988887777'],['+55 (31) 98888-7777','5531988887777'],['+351 912 345 678','351912345678'],['+1 (202) 555-0123','12025550123']
 ])('normalizes %s without guessing an explicit foreign country',async(input,expected)=>{
  const dto=make(input);expect(dto.phone).toBe(expected);expect(await validate(dto)).toHaveLength(0);
 });
 it.each(['123','abc','351912345678','++5531988887777',123])('rejects malformed or ambiguous input %s',async input=>{
  expect((await validate(make(input))).some(e=>e.property==='phone')).toBe(true);
 });
});
