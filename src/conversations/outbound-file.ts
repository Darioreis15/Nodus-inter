import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { AttachmentFile } from './attachment-upload';
import { MEDIA_MAX_BYTES, mediaMetadata, validMediaBytes } from './message-media';

export const OUTBOUND_MIMES = [
 'image/jpeg','image/png','image/webp','application/pdf',
 'application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
// Inspect the ZIP directory without extracting/decompressing untrusted Office data.
export function validOfficeZip(bytes:Buffer,mime:string) {
 const end=bytes.lastIndexOf(Buffer.from([80,75,5,6]));
 if(end<0 || end+22>bytes.length || end+22+bytes.readUInt16LE(end+20)!==bytes.length)return false;
 if(bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0)return false;
 const count=bytes.readUInt16LE(end+10), size=bytes.readUInt32LE(end+12), start=bytes.readUInt32LE(end+16);
 if(!count || count>10000 || start+size!==end || bytes.readUInt16LE(end+8)!==count)return false;
 const names=new Set<string>();let pos=start,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>end || bytes.readUInt32LE(pos)!==0x02014b50)return false;
  const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),compressed=bytes.readUInt32LE(pos+20),uncompressed=bytes.readUInt32LE(pos+24);
  const length=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42);
  if(pos+46+length+extra+comment>end || flags&1 || ![0,8].includes(method))return false;
  const name=bytes.subarray(pos+46,pos+46+length).toString('utf8');
  if(names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\') || /vbaproject|activex|embeddings/i.test(name))return false;
  if(offset+30>start || bytes.readUInt32LE(offset)!==0x04034b50)return false;
  const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28);
  if(bytes.subarray(offset+30,offset+30+localName).toString('utf8')!==name || offset+30+localName+localExtra+compressed>start)return false;
  total+=uncompressed;
  if(total>100*1024*1024 || uncompressed>Math.max(1,compressed)*200)return false;
  names.add(name);pos+=46+length+extra+comment;
 }
 const required=mime.includes('spreadsheetml')?'xl/workbook.xml':mime.includes('wordprocessingml')?'word/document.xml':'ppt/presentation.xml';
 return pos===end && names.has('[Content_Types].xml') && names.has(required);
}
export function validateOutboundFile(file:AttachmentFile|undefined,pdfOnly=false){
 if(!file?.buffer?.length)throw new BadRequestException('Selecione um arquivo para enviar.');
 if(file.buffer.length>MEDIA_MAX_BYTES)throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.');
 const mime=file.mimetype;
 if(!OUTBOUND_MIMES.includes(mime) || (pdfOnly && mime!=='application/pdf') || !validMediaBytes(file.buffer,mime))throw new UnsupportedMediaTypeException('Conteudo do arquivo nao corresponde a um formato permitido.');
 if(mime.includes('openxmlformats') && !validOfficeZip(file.buffer,mime))throw new UnsupportedMediaTypeException('Documento Office invalido ou com conteudo nao permitido.');
 const legacy:Record<string,string[]>={'application/vnd.ms-excel':['Workbook','Book'],'application/msword':['WordDocument'],'application/vnd.ms-powerpoint':['PowerPoint Document']};
 if(legacy[mime] && !legacy[mime].some(name=>file.buffer.includes(Buffer.from(name,'utf16le'))))throw new UnsupportedMediaTypeException('Documento Office nao corresponde ao tipo informado.');
 return mediaMetadata(mime,file.originalname,undefined,file.buffer.length)!;
}
