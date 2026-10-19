import { WebhooksService } from './webhooks.service';

describe('Comprovantes de entrega e leitura', () => {
  it('mantem READ com eventos atrasados e isola canal e direcao', async () => {
    const rows = [
      { externalId: 'abc', channelId: 'one', direction: 'OUTBOUND', status: 'SENT' },
      { externalId: 'abc', channelId: 'two', direction: 'OUTBOUND', status: 'SENT' },
      { externalId: 'abc', channelId: 'one', direction: 'INBOUND', status: 'RECEIVED' },
    ];
    const updateMany = jest.fn(async ({where, data}) => {
      for (const row of rows) {
        if (row.externalId === where.externalId && row.channelId === where.conversation.channelId && row.direction === where.direction && where.status.in.includes(row.status)) row.status = data.status;
      }
    });
    const service = new WebhooksService({ channel: {findUnique: jest.fn().mockResolvedValue({id:'one'})}, message: {updateMany}} as any, {} as any);
    await service.handleEvolutionEvent('one', {event:'MESSAGES_UPDATE',data:{keyId:'abc',fromMe:true,status:'READ'}});
    await service.handleEvolutionEvent('one', {event:'messages.update',data:[{key:{id:'abc',fromMe:true},update:{status:3}},{keyId:'abc',status:'SERVER_ACK'},{keyId:'abc',status:'ERROR'}]});
    expect(rows.map(r => r.status)).toEqual(['READ','SENT','RECEIVED']);
    expect(updateMany).toHaveBeenCalledTimes(4);
    await service.handleEvolutionEvent('one', {event:'messages.update',data:[{keyId:'abc',status:'unknown'},{status:'READ'},{keyId:'abc',fromMe:false,status:'READ'}]});
    expect(updateMany).toHaveBeenCalledTimes(4);
  });

  it('recebe PDF sem texto e mantem a referencia do arquivo', async () => {
    const channel = {id:'one',externalId:'instance'};
    const recordInboundMessage = jest.fn();
    const service = new WebhooksService({channel:{findUnique:jest.fn().mockResolvedValue(channel)}} as any, {recordInboundMessage} as any);
    await service.handleEvolutionEvent('one', {event:'messages.upsert',data:{key:{id:'pdf-1',remoteJid:'5511999999999@s.whatsapp.net',fromMe:false},message:{documentMessage:{mimetype:'application/pdf',fileName:'boleto.pdf',fileLength:1234}}}});
    expect(recordInboundMessage).toHaveBeenCalledWith(channel,'5511999999999','','pdf-1',expect.anything(),undefined,{kind:'document',mimeType:'application/pdf',fileName:'boleto.pdf',sizeBytes:1234});
  });
});
