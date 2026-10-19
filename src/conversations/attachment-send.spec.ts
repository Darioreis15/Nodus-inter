import { AttachmentSendService } from './attachment-send.service';
import { EvolutionConnector } from '../channels/connectors/evolution.connector';
import { MetaConnector } from '../channels/connectors/meta.connector';
import { seal } from '../security/secrets';

describe('Envio de anexos',()=>{
  const pdf={buffer:Buffer.from('%PDF-1.7 test'),mimetype:'application/pdf',originalname:'boleto.pdf',size:13};
  let prisma:any, evolution:any, meta:any, service:AttachmentSendService, conversation:any;
  beforeEach(()=>{
    conversation={id:'c',channel:{id:'ch',tenantId:'t',type:'QR_EVOLUTION',status:'CONNECTED',externalId:'instance'},contact:{waId:'5511999999999'}};
    prisma={conversation:{findFirst:jest.fn().mockResolvedValue(conversation),update:jest.fn()},message:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn(async({data})=>({id:'m',...data})),update:jest.fn(async({data})=>({id:'existing',status:'READ',...data}))},$queryRaw:jest.fn()};
    prisma.$transaction=jest.fn(fn=>fn(prisma));
    evolution={sendMedia:jest.fn().mockResolvedValue({externalId:'remote'})};meta={sendMedia:jest.fn().mockResolvedValue({externalId:'wamid',providerId:'123'})};
    service=new AttachmentSendService(prisma,evolution,meta);
  });
  it('nega acesso a conversa de outra empresa antes do provedor',async()=>{
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.send('other','c',pdf)).rejects.toThrow('Conversa nao encontrada');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'c',channel:{tenantId:'other'}}}));
    expect(evolution.sendMedia).not.toHaveBeenCalled();
  });
  it('valida assinatura e tamanho antes de enviar',async()=>{
    await expect(service.send('t','c',{...pdf,buffer:Buffer.from('<html>bad</html>')})).rejects.toThrow('formato permitido');
    await expect(service.send('t','c',{...pdf,buffer:Buffer.alloc(10*1024*1024+1)})).rejects.toThrow('10 MB');
    await expect(service.send('t','c',undefined)).rejects.toThrow('Selecione');
    expect(evolution.sendMedia).not.toHaveBeenCalled();
  });
  it('salva metadados e aguarda cliente sem armazenar binario',async()=>{
    const result=await service.send('t','c',pdf,'Segue boleto');
    expect(result).toMatchObject({id:'m',body:'Segue boleto',media:{kind:'document',fileName:'boleto.pdf'},status:'SENT'});
    expect(prisma.message.create.mock.calls[0][0].data).not.toHaveProperty('buffer');
    expect(prisma.conversation.update).toHaveBeenCalledWith({where:{id:'c'},data:{status:'PENDING'}});
  });
  it('deduplica eco que chegou antes da resposta e preserva READ',async()=>{
    prisma.message.findFirst.mockResolvedValue({id:'existing',status:'READ'});
    const result=await service.send('t','c',pdf);
    expect(result.status).toBe('READ');expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.message.update.mock.calls[0][0].data).not.toHaveProperty('status');
  });
  it('respeita janela Meta e nao expoe providerId',async()=>{
    conversation.channel.type='OFFICIAL_META';
    await expect(service.send('t','c',pdf)).rejects.toThrow('janela');expect(meta.sendMedia).not.toHaveBeenCalled();
    prisma.message.findFirst.mockResolvedValueOnce({id:'inbound'}).mockResolvedValueOnce(null);
    const result=await service.send('t','c',pdf);
    expect(prisma.message.create.mock.calls[0][0].data.media.providerId).toBe('123');
    expect(result.media).not.toHaveProperty('providerId');
  });
  it('limita imagem Meta a 5 MB e rejeita WebP',async()=>{
    conversation.channel.type='OFFICIAL_META';
    const jpeg=Buffer.alloc(5*1024*1024+1);jpeg[0]=255;jpeg[1]=216;jpeg[2]=255;
    await expect(service.send('t','c',{...pdf,buffer:jpeg,mimetype:'image/jpeg'})).rejects.toThrow('5 MB');
    await expect(service.send('t','c',{...pdf,buffer:Buffer.from('RIFF0000WEBP'),mimetype:'image/webp'})).rejects.toThrow('JPEG ou PNG');
    expect(meta.sendMedia).not.toHaveBeenCalled();
  });
  it('nao grava sucesso quando o provedor falha',async()=>{
    evolution.sendMedia.mockRejectedValue(new Error('offline'));
    await expect(service.send('t','c',pdf)).rejects.toThrow();expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe('Conectores de anexos',()=>{
  const oldFetch=global.fetch;
  const message={to:'5511999999999',caption:'teste',buffer:Buffer.from('%PDF-1.7'),media:{kind:'document' as const,mimeType:'application/pdf',fileName:'arquivo.pdf'}};
  afterEach(()=>{global.fetch=oldFetch;});
  it('envia base64 a Evolution sem URL publica e exige ID real',async()=>{
    process.env.EVOLUTION_API_BASE_URL='https://evolution.example';process.env.EVOLUTION_API_KEY='test-key';
    global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({key:{id:'real'}})));
    const connector=new EvolutionConnector();
    await expect(connector.sendMedia({config:{instanceName:'instance'}} as any,message)).resolves.toEqual({externalId:'real'});
    const request=(global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({mediatype:'document',mimetype:'application/pdf',fileName:'arquivo.pdf',media:message.buffer.toString('base64')});
    (global.fetch as jest.Mock).mockResolvedValue(new Response('{}'));
    await expect(connector.sendMedia({config:{instanceName:'instance'}} as any,message)).rejects.toThrow('confirmacao');
  });
  it('faz upload multipart e envia media ID na Meta',async()=>{
    global.fetch=jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:'123'}))).mockResolvedValueOnce(new Response(JSON.stringify({messages:[{id:'wamid'}]})));
    const result=await new MetaConnector().sendMedia({config:{phoneNumberId:'456',accessToken:seal('token','meta:456')}} as any,message);
    expect(result).toEqual({externalId:'wamid',providerId:'123'});
    const upload=(global.fetch as jest.Mock).mock.calls[0][1];
    expect(upload.body.get('messaging_product')).toBe('whatsapp');expect(upload.body.get('file').type).toBe('application/pdf');
    expect(upload.headers).not.toHaveProperty('Content-Type');
    const payload=JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(payload.document).toEqual({id:'123',caption:'teste',filename:'arquivo.pdf'});
  });
});
