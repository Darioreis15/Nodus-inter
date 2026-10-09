import { NotFoundException } from '@nestjs/common';
import { ContactPhotosService, safeProfilePhoto } from './contact-photos.service';
import { EvolutionConnector } from '../channels/connectors/evolution.connector';

const photo = 'https://pps.whatsapp.net/v/profile.jpg?sig=test';
const row = () => ({ channel: { id:'channel', type:'QR_EVOLUTION', status:'CONNECTED', config:{instanceName:'instance'} }, contact:{id:'contact',waId:'5531999999999'} });

describe('Fotos dos contatos', () => {
  const setup = () => {
    const prisma:any = {conversation:{findFirst:jest.fn().mockResolvedValue(row())}};
    const evolution:any = {profilePicture:jest.fn().mockResolvedValue(photo)};
    return {prisma,evolution,service:new ContactPhotosService(prisma,evolution)};
  };
  afterEach(()=>jest.restoreAllMocks());
  it('consulta somente o contato da conversa autorizada; cache evita repetir chamada', async () => {
    const {prisma,evolution,service}=setup();
    expect(await service.forConversation('tenant','conversation')).toEqual({url:photo});
    await service.forConversation('tenant','conversation');
    expect(prisma.conversation.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({id:'conversation',channel:{tenantId:'tenant'},contact:{tenantId:'tenant'}});
    expect(evolution.profilePicture).toHaveBeenCalledTimes(1);
    expect(evolution.profilePicture).toHaveBeenCalledWith('instance','5531999999999');
  });
  it('cache nunca contorna exclusao ou falta de acesso a outra empresa', async () => {
    const {prisma,evolution,service}=setup();
    await service.forConversation('tenant','conversation');
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.forConversation('other','conversation')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forConversation('tenant','conversation')).rejects.toBeInstanceOf(NotFoundException);
    expect(evolution.profilePicture).toHaveBeenCalledTimes(1);
  });
  it('nao compartilha cache entre empresas ou canais', async () => {
    const {prisma,evolution,service}=setup();
    await service.forConversation('a','conversation');await service.forConversation('b','conversation');
    const next=row();next.channel.id='other';prisma.conversation.findFirst.mockResolvedValue(next);
    await service.forConversation('a','conversation');expect(evolution.profilePicture).toHaveBeenCalledTimes(3);
  });
  it.each(['OFFICIAL_META','DISCONNECTED','GROUP'])('usa iniciais para %s sem consultar Evolution', async mode => {
    const {prisma,evolution,service}=setup(), data=row();
    if(mode==='OFFICIAL_META')data.channel.type=mode;
    else if(mode==='DISCONNECTED')data.channel.status=mode;
    else data.contact.waId='120363045049558686';
    prisma.conversation.findFirst.mockResolvedValue(data);
    expect(await service.forConversation('a','c')).toEqual({url:null});expect(evolution.profilePicture).not.toHaveBeenCalled();
  });
  it('falhas e fotos privadas tem cache curto; fotos disponiveis expiram em 5 minutos', async () => {
    const {evolution,service}=setup();let now=1000;jest.spyOn(Date,'now').mockImplementation(()=>now);
    evolution.profilePicture.mockRejectedValueOnce(new Error('private'));
    expect(await service.forConversation('a','c')).toEqual({url:null});await service.forConversation('a','c');expect(evolution.profilePicture).toHaveBeenCalledTimes(1);
    now+=60001;expect(await service.forConversation('a','c')).toEqual({url:photo});
    now+=299999;await service.forConversation('a','c');expect(evolution.profilePicture).toHaveBeenCalledTimes(2);
    now+=2;await service.forConversation('a','c');expect(evolution.profilePicture).toHaveBeenCalledTimes(3);
  });
  it('deduplica chamadas concorrentes ao mesmo contato', async () => {
    const {evolution,service}=setup();
    await Promise.all([service.forConversation('a','c'),service.forConversation('a','c')]);expect(evolution.profilePicture).toHaveBeenCalledTimes(1);
  });
  it.each(['http://pps.whatsapp.net/a','https://localhost/a','https://127.0.0.1/a','https://pps.whatsapp.net.evil.test/a','https://user:secret@pps.whatsapp.net/a','https://pps.whatsapp.net:8080/a','data:image/svg+xml,test','javascript:alert(1)',null])('rejeita URL nao confiavel %s', url => expect(safeProfilePhoto(url)).toBeNull());
  it('limita o total de consultas simultaneas ao provedor', async () => {
    const {prisma,evolution,service}=setup();let release!:(value:string)=>void;
    evolution.profilePicture.mockReturnValue(new Promise(resolve=>release=resolve));
    prisma.conversation.findFirst.mockImplementation(async ({where}:any)=>({...row(),contact:{...row().contact,id:where.id}}));
    const jobs=Array.from({length:8},(_,i)=>service.forConversation('a',String(i)));
    await Promise.resolve();await Promise.resolve();
    expect(await service.forConversation('a','ninth')).toEqual({url:null});
    release(photo);await Promise.all(jobs);expect(evolution.profilePicture).toHaveBeenCalledTimes(8);
  });
});

describe('Consulta de foto na Evolution',()=>{
  const original={...process.env};
  afterEach(()=>{jest.restoreAllMocks();process.env={...original};});
  it('usa endpoint documentado sem repassar a chave na resposta',async()=>{
    process.env.EVOLUTION_API_BASE_URL='https://evolution.test';process.env.EVOLUTION_API_KEY='test-secret';
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({profilePictureUrl:photo})} as any);
    expect(await new EvolutionConnector().profilePicture('inst/name','5531999999999')).toBe(photo);
    expect(fetchMock).toHaveBeenCalledWith('https://evolution.test/chat/fetchProfilePictureUrl/inst%2Fname',expect.objectContaining({method:'POST',redirect:'error',headers:{'Content-Type':'application/json',apikey:'test-secret'},body:JSON.stringify({number:'5531999999999'})}));
  });
  it('timeout e respostas sem foto nao impedem o atendimento',async()=>{
    process.env.EVOLUTION_API_BASE_URL='https://evolution.test';process.env.EVOLUTION_API_KEY='test-secret';
    const stub=jest.spyOn(global,'fetch').mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ok:false} as any).mockResolvedValueOnce({ok:true,json:async()=>({profilePictureUrl:null})} as any);
    const connector=new EvolutionConnector();
    for(let i=0;i<3;i++)expect(await connector.profilePicture('instance','5531999999999')).toBeNull();
    expect(stub).toHaveBeenCalledTimes(3);
  });
});
