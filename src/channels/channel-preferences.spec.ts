import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChannelsService } from './channels.service';
import { UpdateGroupPreferencesDto } from './dto/update-group-preferences.dto';
import { UpdateAutoReplyDto } from './dto/update-auto-reply.dto';

describe('Preferencias de canal', () => {
  function setup(channel: any = { id: 'channel', type: 'QR_EVOLUTION', config: { instanceName: 'existing', onlyCustomerInitiated: true } }) {
    const tx: any = { $queryRaw: jest.fn(), channel: { findFirst: jest.fn().mockResolvedValue(channel), findFirstOrThrow: jest.fn().mockResolvedValue(channel), update: jest.fn() }, tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({workspaceSettings:{}}) } };
    tx.$transaction = (fn: any) => fn(tx);
    return { tx, service: new ChannelsService(tx, {} as any) };
  }
  it('salva sem substituir as credenciais nem preferencias existentes e limita ao tenant', async () => {
    const { tx, service } = setup();
    await expect(service.updateGroups('tenant', 'channel', false)).resolves.toEqual({ id:'channel', receiveGroupMessages:false });
    expect(tx.channel.findFirst).toHaveBeenCalledWith({where:{id:'channel',tenantId:'tenant'}});
    expect(tx.channel.update).toHaveBeenCalledWith(expect.objectContaining({data:{config:{instanceName:'existing',onlyCustomerInitiated:true,receiveGroupMessages:false}}}));
  });
  it('rejeita canal de outra empresa e canal oficial', async () => {
    await expect(setup(null).service.updateGroups('other','channel',false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({type:'OFFICIAL_META'}).service.updateGroups('tenant','channel',false)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('salva modo de boas-vindas preservando token e grupos', async () => {
    const { tx, service } = setup({id:'channel',config:{accessToken:'sealed',receiveGroupMessages:false}});
    await service.updateAutoReply('tenant','channel',true,'Ola',null,true);
    expect(tx.channel.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({config:{accessToken:'sealed',receiveGroupMessages:false,onlyCustomerInitiated:true}})}));
  });
  it('consulta do provedor nao sobrescreve uma preferencia salva enquanto aguardava', async () => {
    const { tx } = setup();
    tx.channel.findFirst.mockResolvedValueOnce({id:'channel',type:'QR_EVOLUTION',config:{instanceName:'existing',receiveGroupMessages:true}})
      .mockResolvedValue({id:'channel',config:{instanceName:'existing',receiveGroupMessages:false}});
    const service = new ChannelsService(tx,{connection:jest.fn().mockResolvedValue({status:'CONNECTED',phoneNumber:'5531999999999'})} as any);
    await service.refresh('tenant','channel');
    expect(tx.channel.update).toHaveBeenCalledWith(expect.objectContaining({data:{status:'CONNECTED',config:{instanceName:'existing',receiveGroupMessages:false,phoneNumber:'5531999999999'}}}));
  });
  it('exige booleanos reais' , () => {
    expect(validateSync(plainToInstance(UpdateGroupPreferencesDto,{receiveGroupMessages:'false'}))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateGroupPreferencesDto,{receiveGroupMessages:false}))).toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateAutoReplyDto,{enabled:true,onlyCustomerInitiated:'false'}))).not.toHaveLength(0);
  });
});
