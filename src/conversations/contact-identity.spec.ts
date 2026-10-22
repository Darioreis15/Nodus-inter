import { phoneAliases, resolveContact, isPhoneSuppressed } from './contact-identity';
import { createHash } from 'crypto';

describe('Identidade de celulares brasileiros', () => {
  it.each(['553198051379','5531998051379'])('reconhece com/sem nono digito: %s', phone => {
    expect(new Set(phoneAliases(phone))).toEqual(new Set(['553198051379','5531998051379']));
  });
  it.each(['553132345678','5531932345678','14155552671','120363045049558686','553198051379@g.us','550098051379','551199123456789'])('preserva fixos, internacionais, grupos e invalidos: %s', phone => {
    expect(phoneAliases(phone)).toEqual([phone]);
  });
  it('prefere contato com atendimento ativo no mesmo tenant/canal, sem criar outro', async () => {
    const existing = {id:'old',waId:'553198051379'};
    const tx:any = {contact:{findFirst:jest.fn().mockResolvedValue(existing),upsert:jest.fn()}};
    expect(await resolveContact(tx,'company','channel','5531998051379')).toBe(existing);
    expect(tx.contact.findFirst.mock.calls[0][0].where).toEqual({tenantId:'company',waId:{in:expect.arrayContaining(['553198051379','5531998051379'])},conversations:{some:{channelId:'channel',status:{in:['OPEN','PENDING']}}}});
    expect(tx.contact.upsert).not.toHaveBeenCalled();
  });
  it('reutiliza contato sem atendimento ativo e preserva seu nome e telefone', async () => {
    const existing={id:'old',name:'Maria',waId:'553198051379'};
    const tx:any={contact:{findFirst:jest.fn().mockResolvedValueOnce(null).mockResolvedValue(existing),upsert:jest.fn()}};
    expect(await resolveContact(tx,'company','channel','5531998051379','Outro nome')).toBe(existing);
    expect(tx.contact.upsert).not.toHaveBeenCalled();
  });
  it('cria sem alterar o endereco do provedor se nenhum alias existe', async () => {
    const tx:any={contact:{findFirst:jest.fn().mockResolvedValue(null),upsert:jest.fn().mockResolvedValue({id:'new'})}};
    await resolveContact(tx,'company','channel','5531998051379','Maria');
    expect(tx.contact.upsert.mock.calls[0][0].create).toEqual({tenantId:'company',waId:'5531998051379',name:'Maria'});
  });
  it('respeita opt-out antigo cadastrado sem o nono digito', async () => {
    const oldHash=createHash('sha256').update('company:553198051379').digest('hex');
    const db:any={campaignSuppression:{findUnique:jest.fn(async ({where}) => where.tenantId_phoneHash.phoneHash===oldHash ? {} : null)}};
    expect(await isPhoneSuppressed(db,'company','5531998051379')).toBe(true);
    expect(await isPhoneSuppressed(db,'other','5531998051379')).toBe(false);
  });
});
