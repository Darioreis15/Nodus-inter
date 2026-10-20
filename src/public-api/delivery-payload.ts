import { BadRequestException } from '@nestjs/common';
import { AttachmentFile } from '../conversations/attachment-upload';
import { validateOutboundFile } from '../conversations/outbound-file';
import { DeliveryDto } from './delivery-input';

export interface DeliveryPayload {
 kind:'TEXT'|'ATTACHMENT'|'TEMPLATE'; text?:string;caption?:string;
 name?:string;language?:string;parameters?:string[];
 file?:{data:string;mimetype:string;originalname:string};
}
export function deliveryPayload(dto:DeliveryDto,file?:AttachmentFile):DeliveryPayload {
 const fail=()=>{throw new BadRequestException('Campos incompativeis com o tipo de envio.');};
 const has=(...names:string[])=>names.some(n=>(dto as any)[n]!==undefined);
 if(dto.kind==='TEXT'){
  if(!dto.text || file || has('caption','name','language','parameters'))return fail();
  return {kind:dto.kind,text:dto.text};
 }
 if(dto.kind==='ATTACHMENT'){
  if(has('text','name','language','parameters'))return fail();
  validateOutboundFile(file);
 }else if(dto.kind==='TEMPLATE'){
  if(!dto.name || !dto.language || !Array.isArray(dto.parameters) || has('text','caption'))return fail();
  if(file)validateOutboundFile(file,true);
 }else return fail();
 // Keep the original file name in the fingerprint; normalize only when sending.
 return dto.kind==='ATTACHMENT'
  ? {kind:dto.kind,caption:dto.caption||'',file:serializeFile(file!)}
  : {kind:dto.kind,name:dto.name,language:dto.language,parameters:dto.parameters,...(file?{file:serializeFile(file)}:{})};
}
const serializeFile=(file:AttachmentFile)=>({data:file.buffer.toString('base64'),mimetype:file.mimetype,originalname:file.originalname});
export function deserializeFile(file:DeliveryPayload['file']):AttachmentFile|undefined {
 if(!file)return;
 const buffer=Buffer.from(file.data,'base64');return {buffer,size:buffer.length,mimetype:file.mimetype,originalname:file.originalname};
}
