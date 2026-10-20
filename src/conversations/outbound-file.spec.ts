import { validateOutboundFile } from './outbound-file';
function zip(names:string[]){
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const name of names){const n=Buffer.from(name),a=Buffer.alloc(30),b=Buffer.alloc(46);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(n.length,26);b.writeUInt32LE(0x02014b50);b.writeUInt16LE(n.length,28);b.writeUInt32LE(offset,42);local.push(a,n);central.push(b,n);offset+=a.length+n.length;}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
const xlsx='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file=(buffer:Buffer,mimetype=xlsx)=>({buffer,size:buffer.length,mimetype,originalname:'fatura.xlsx'});
describe('Office uploads',()=>{
 it('accepts Excel OOXML with workbook and preserves document metadata',()=>{
  const media=validateOutboundFile(file(zip(['[Content_Types].xml','xl/workbook.xml'])));expect(media).toMatchObject({kind:'document',fileName:'fatura.xlsx',mimeType:xlsx});
 });
 it.each([['other.txt'],['[Content_Types].xml','word/document.xml'],['[Content_Types].xml','xl/workbook.xml','xl/vbaProject.bin'],['[Content_Types].xml','xl/workbook.xml','../x']])('rejects mismatched or unsafe ZIP %j',(...names:string[])=>{
  expect(()=>validateOutboundFile(file(zip(names)))).toThrow();
 });
 it('rejects malformed ZIP and PDFs renamed to Excel',()=>{
  expect(()=>validateOutboundFile(file(Buffer.from('%PDF-1.7')))).toThrow();expect(()=>validateOutboundFile(file(Buffer.from('PK\x03\x04')))).toThrow();
 });
 it('accepts legacy Excel only with its container and Workbook marker',()=>{
  const bytes=Buffer.concat([Buffer.from([208,207,17,224,161,177,26,225]),Buffer.alloc(100),Buffer.from('Workbook','utf16le')]);
  expect(validateOutboundFile(file(bytes,'application/vnd.ms-excel')).fileName).toBe('fatura.xls');
  expect(()=>validateOutboundFile(file(bytes,'application/msword'))).toThrow();
 });
});
