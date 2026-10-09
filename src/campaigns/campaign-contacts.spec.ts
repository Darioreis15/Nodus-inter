import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CampaignsService, phoneHash, renderStep } from './campaigns.service';
import { CampaignContactsQueryDto } from './campaigns.dto';
import { NotFoundException } from '@nestjs/common';
function setup(rows:any[]=[]){
 const db:any={channel:{findFirst:jest.fn().mockResolvedValue({id:'channel'})},contact:{findMany:jest.fn().mockResolvedValue(rows)},campaignSuppression:{findMany:jest.fn().mockResolvedValue([])}};
 return{db,service:new CampaignsService(db,{} as any)};
}
describe('Contatos elegiveis para campanhas',()=>{
 it('busca nome/telefone e aplica todos os filtros na mesma conversa da empresa',async()=>{
  const {db,service}=setup([{id:'a',name:'Maria',waId:'5531999999999'}]);
  const result=await service.contacts('tenant',{search:'Maria',channelId:'channel',departmentId:'dept',stageId:'stage'});
  expect(result).toEqual({contacts:[{id:'a',name:'Maria',phone:'5531999999999'}],nextCursor:null});
  const q=db.contact.findMany.mock.calls[0][0];
  expect(q.where).toEqual({tenantId:'tenant',conversations:{some:{channel:{tenantId:'tenant'},messages:{some:{}},channelId:'channel',departmentId:'dept',funnelStage:'stage'}},OR:[{name:{contains:'Maria',mode:'insensitive'}}]});
  expect(q.take).toBe(51);expect(q.select).toEqual({id:true,name:true,waId:true});
  expect(db.campaignSuppression.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant',phoneHash:{in:[phoneHash('tenant','5531999999999')]}},select:{phoneHash:true}});
 });
 it('remove descadastrados e identificadores de grupo; nome pode ser nulo',async()=>{
  const {db,service}=setup([{id:'a',name:'Bloqueado',waId:'5531999999999'},{id:'b',name:null,waId:'5531888888888'},{id:'g',name:'Grupo',waId:'120363045049558686'}]);
  db.campaignSuppression.findMany.mockResolvedValue([{phoneHash:phoneHash('tenant','5531999999999')}]);
  expect((await service.contacts('tenant',{})).contacts).toEqual([{id:'b',name:null,phone:'5531888888888'}]);
 });
 it('continua paginacao mesmo quando a pagina inteira foi excluida',async()=>{
  const {db,service}=setup(Array.from({length:51},(_,i)=>({id:String(i),waId:'120363045049558686',name:null})));
  expect(await service.contacts('tenant',{cursor:'previous'})).toEqual({contacts:[],nextCursor:'49'});
  expect(db.contact.findMany.mock.calls[0][0].where.id).toEqual({gt:'previous'});
  expect(db.campaignSuppression.findMany).not.toHaveBeenCalled();
 });
 it('nao consulta contatos de um canal de outra empresa',async()=>{
  const {db,service}=setup();db.channel.findFirst.mockResolvedValue(null);
  await expect(service.contacts('tenant',{channelId:'foreign'})).rejects.toBeInstanceOf(NotFoundException);
  expect(db.contact.findMany).not.toHaveBeenCalled();
 });
 it('busca telefone formatado usando digitos e valida cursores e filtros',async()=>{
  const {db,service}=setup();await service.contacts('tenant',{search:'(31) 99999-9999'});
  expect(db.contact.findMany.mock.calls[0][0].where.OR).toContainEqual({waId:{contains:'31999999999'}});
  expect(validateSync(plainToInstance(CampaignContactsQueryDto,{cursor:'not-uuid'}))).not.toHaveLength(0);
  expect(validateSync(plainToInstance(CampaignContactsQueryDto,{search:'x'.repeat(81)}))).not.toHaveLength(0);
 });
 it('inclui instrucao de saida sem duplicar uma orientacao ja escrita',()=>{
  const s:any={type:'TEXT',text:'Ola {{nome}}',delayMinutes:0};
  expect(renderStep(s,{phone:'5531999999999',name:'Maria'}).text).toBe('Ola Maria\n\nPara não receber mais campanhas, responda SAIR.');
  expect(renderStep({...s,text:'Ola. Responda SAIR para cancelar.'},{phone:'5531999999999'}).text).toBe('Ola. Responda SAIR para cancelar.');
  expect(()=>renderStep({...s,text:'x'.repeat(3990)},{phone:'5531999999999'})).toThrow();
  const template:any={type:'TEMPLATE',delayMinutes:0,template:{name:'aviso',language:'pt_BR',parameters:['{{nome}}']}};
  expect(renderStep(template,{phone:'5531999999999',name:'Maria'})).toEqual({...template,template:{...template.template,parameters:['Maria']}});
 });
});
