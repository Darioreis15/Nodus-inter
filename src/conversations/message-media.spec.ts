import { evolutionContent, metaContent, publicMedia, validMediaBytes, MEDIA_MAX_BYTES } from './message-media';
import { MessageMediaService, trustedMetaMediaUrl, limitedBytes } from './message-media.service';
import { seal } from '../security/secrets';

describe('Media metadata and protected downloads', () => {
  const pdf = Buffer.from('%PDF-1.7\nexample');
  let prisma:any, rate:any, service:MessageMediaService, message:any;
  const savedFetch=global.fetch, savedBase=process.env.EVOLUTION_API_BASE_URL, savedKey=process.env.EVOLUTION_API_KEY;
  beforeEach(()=>{
    process.env.EVOLUTION_API_BASE_URL='https://evolution.example';process.env.EVOLUTION_API_KEY='secret';
    message={externalId:'external',media:{kind:'document',mimeType:'application/pdf',fileName:'boleto.pdf'},conversation:{channel:{type:'QR_EVOLUTION',config:{instanceName:'instance'}}}};
    prisma={message:{findFirst:jest.fn().mockResolvedValue(message)}};rate={consume:jest.fn()};service=new MessageMediaService(prisma,rate);
    global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({base64:pdf.toString('base64')})));
  });
  afterEach(()=>{global.fetch=savedFetch;});
  afterAll(()=>{if(savedBase===undefined)delete process.env.EVOLUTION_API_BASE_URL;else process.env.EVOLUTION_API_BASE_URL=savedBase;if(savedKey===undefined)delete process.env.EVOLUTION_API_KEY;else process.env.EVOLUTION_API_KEY=savedKey;});
  it('extracts supported Evolution and Meta media without retaining URLs/keys/base64',()=>{
    const evo=evolutionContent({message:{documentWithCaptionMessage:{message:{documentMessage:{mimetype:'application/pdf',fileName:'invoice.pdf',caption:'Boleto',mediaKey:'secret',url:'http://localhost',fileLength:40}}}}});
    expect(evo).toMatchObject({text:'Boleto',media:{kind:'document',fileName:'invoice.pdf',sizeBytes:40}});
    expect(JSON.stringify(evo)).not.toMatch(/localhost|secret/);
    const meta=metaContent({type:'image',image:{mime_type:'image/jpeg',id:'123',caption:'Foto'}});
    expect(meta).toMatchObject({text:'Foto',media:{providerId:'123',kind:'image'}});
    expect(publicMedia(meta.media)).not.toHaveProperty('providerId');
  });
  it('does not unwrap view-once media or allow SVG/HTML',()=>{
    expect(evolutionContent({message:{viewOnceMessage:{message:{imageMessage:{mimetype:'image/jpeg'}}}}}).media).toBeNull();
    expect(metaContent({type:'document',document:{mime_type:'text/html'}}).media).toBeNull();
    expect(publicMedia({mimeType:'image/svg+xml',fileName:'x.svg'})).toBeNull();
    expect(publicMedia({mimeType:'image/png',fileName:'a.html'})).toMatchObject({fileName:'a.png'});
  });
  it('enforces tenant and conversation scope before any provider request',async()=>{
    prisma.message.findFirst.mockResolvedValue(null);
    await expect(service.download('other-tenant','conversation','message')).rejects.toThrow('Anexo nao encontrado');
    expect(prisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'message',conversationId:'conversation',conversation:{channel:{tenantId:'other-tenant'}}}}));
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('downloads via fixed Evolution endpoint using only stored instance and external ID',async()=>{
    const result=await service.download('tenant','conversation','message');
    expect(result.buffer).toEqual(pdf);expect(result.mimeType).toBe('application/pdf');
    expect(global.fetch).toHaveBeenCalledWith('https://evolution.example/chat/getBase64FromMediaMessage/instance',expect.objectContaining({redirect:'error',body:JSON.stringify({message:{key:{id:'external'}},convertToMp4:false})}));
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('rejects oversized metadata before downloading',async()=>{
    message.media.sizeBytes=MEDIA_MAX_BYTES+1;
    await expect(service.download('tenant','conversation','message')).rejects.toThrow('10 MB');expect(global.fetch).not.toHaveBeenCalled();
  });
  it('caps streamed bodies even without Content-Length and rejects forged file signatures',async()=>{
    await expect(limitedBytes(new Response('123456'),5)).rejects.toThrow('10 MB');
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({base64:Buffer.from('<html>bad</html>').toString('base64')})));
    await expect(service.download('tenant','conversation','message')).rejects.toThrow('formato permitido');
    expect(validMediaBytes(pdf,'application/pdf')).toBe(true);expect(validMediaBytes(pdf,'image/jpeg')).toBe(false);
  });
  it('uses a fresh scoped Meta URL and never returns provider credentials',async()=>{
    message.media.providerId='123';message.conversation.channel={type:'OFFICIAL_META',externalId:'456',config:{phoneNumberId:'456',accessToken:seal('meta-secret','meta:456')}};
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(JSON.stringify({id:'123',url:'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123',file_size:pdf.length}))).mockResolvedValueOnce(new Response(pdf));
    const result=await service.download('tenant','conversation','message');expect(result.buffer).toEqual(pdf);
    expect(global.fetch).toHaveBeenNthCalledWith(1,expect.stringContaining('/123?phone_number_id=456'),expect.objectContaining({redirect:'error'}));
    expect(result).not.toHaveProperty('providerId');expect(JSON.stringify(result)).not.toContain('meta-secret');
  });
  it.each(['https://evil.example/file','http://lookaside.fbsbx.com/a','https://lookaside.fbsbx.com.evil.example/a','https://u:p@lookaside.fbsbx.com/a','https://127.0.0.1/a','https://lookaside.fbsbx.com:8443/a'])('rejects unsafe provider URL %s',url=>expect(()=>trustedMetaMediaUrl(url)).toThrow());
  it('sanitizes network errors and allows retry after failure',async()=>{
    (global.fetch as jest.Mock).mockRejectedValue(new Error('secret URL'));
    await expect(service.download('t','c','m')).rejects.toThrow('Nao foi possivel');
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({base64:pdf.toString('base64')})));
    expect((await service.download('t','c','m')).buffer).toEqual(pdf);
  });
});

describe('Received office documents',()=>{
 const office=[['application/msword','doc'],['application/vnd.ms-excel','xls'],['application/vnd.ms-powerpoint','ppt'],['application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx'],['application/vnd.openxmlformats-officedocument.presentationml.presentation','pptx']];
 it.each(office)('recognizes %s from both providers', (mime,ext)=>{
  const evo=evolutionContent({message:{documentMessage:{mimetype:mime,fileName:`arquivo.${ext}`}}});
  const meta=metaContent({type:'document',document:{mime_type:mime,filename:`arquivo.${ext}`,id:'123'}});
  expect(evo.media).toMatchObject({kind:'document',mimeType:mime,fileName:`arquivo.${ext}`});expect(meta.media).toMatchObject({kind:'document',fileName:`arquivo.${ext}`});
  const bytes=ext.endsWith('x')?Buffer.from([80,75,3,4,0]):Buffer.from([208,207,17,224,161,177,26,225]);
  expect(validMediaBytes(bytes,mime)).toBe(true);expect(validMediaBytes(Buffer.from('<html>'),mime)).toBe(false);
 });
 it('keeps unknown binary downloads inert and strips path separators',()=>{expect(publicMedia({mimeType:'application/octet-stream',fileName:'../program.exe'})).toMatchObject({kind:'document',fileName:'.._program.bin'});});
});
