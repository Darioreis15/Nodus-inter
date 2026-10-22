import { costPeriod, parseMetaCosts, MetaCostsService } from './meta-costs.service';
import { metaRequest } from '../channels/connectors/meta-api';
import { seal } from '../security/secrets';
jest.mock('../channels/connectors/meta-api', () => ({metaRequest:jest.fn()}));
const request=metaRequest as jest.Mock;
const point = (overrides={}) => ({start:1790812800,phone_number:'5531999999999',pricing_category:'UTILITY',pricing_type:'REGULAR',volume:5,cost:0.12,...overrides});
const report = (points:any[]) => ({currency:'USD',pricing_analytics:{data:[{data_points:points}]}});

describe('Gastos Meta', () => {
  beforeEach(() => jest.clearAllMocks());
  it('agrega custos reais recebidos e isola o telefone solicitado', () => {
    const result=parseMetaCosts(report([point(),point({cost:0.08,volume:3}),point({phone_number:'5511888888888',cost:500})]),'5531999999999');
    expect(result.totalCost).toBeCloseTo(0.2);expect(result.totalVolume).toBe(8);expect(result.currency).toBe('USD');expect(result.rows).toHaveLength(2);
  });
  it.each([[],[point({cost:undefined})],[point({cost:null})],[point({cost:0.1}),point({cost:undefined})]].map(points => ({points})))('nunca fabrica zero quando custo ausente', ({points}) => {
    expect(parseMetaCosts(report(points),'5531999999999').totalCost).toBeNull();
  });
  it('zero explícito é um valor válido',()=>expect(parseMetaCosts(report([point({cost:0})]),'5531999999999').totalCost).toBe(0));
  it('sem moeda não publica um total monetário',()=>expect(parseMetaCosts({...report([point()]),currency:null},'5531999999999').totalCost).toBeNull());
  it('rejeita resposta incompleta/paginada',()=>expect(()=>parseMetaCosts({pricing_analytics:{data:[],paging:{next:'https://other'}}},'5531999999999')).toThrow());
  it('valida período antes de consultar provedor',()=>{
    expect(costPeriod('2026-02',new Date('2026-10-22T00:00:00Z'))).toEqual({start:1769904000,end:1772323200});
    for(const month of ['2026-13','2026-11','2025-10','abc'])expect(()=>costPeriod(month,new Date('2026-10-22T00:00:00Z'))).toThrow();
  });
  it('rejeita canal de outra empresa sem consultar a Meta',async()=>{
    const prisma:any={channel:{findFirst:jest.fn().mockResolvedValue(null)}};
    await expect(new MetaCostsService(prisma).get('company','foreign',new Date().toISOString().slice(0,7))).rejects.toThrow('Canal oficial nao encontrado');
    expect(prisma.channel.findFirst).toHaveBeenCalledWith({where:{id:'foreign',tenantId:'company',type:'OFFICIAL_META'}});expect(request).not.toHaveBeenCalled();
  });
  it('consulta apenas número da conta verificada, mantém token no backend e reutiliza cache',async()=>{
    const config={phoneNumberId:'123',wabaId:'456',accessToken:seal('secret-token','meta:123')};
    const prisma:any={channel:{findFirst:jest.fn().mockResolvedValue({id:'channel',name:'Oficial',config})}};
    request.mockResolvedValueOnce({data:[{id:'123'}]}).mockResolvedValueOnce({id:'123',display_phone_number:'+55 31 99999-9999'}).mockResolvedValueOnce(report([point()]));
    const service=new MetaCostsService(prisma), month=new Date().toISOString().slice(0,7);
    const result=await service.get('company','channel',month);
    expect(await service.get('company','channel',month)).toEqual(result);expect(request).toHaveBeenCalledTimes(3);
    const fields=new URLSearchParams(request.mock.calls[2][0].split('?')[1]).get('fields');
    expect(fields).toContain('phone_numbers(["5531999999999"])');expect(fields).toContain('granularity(DAILY)');
    expect(JSON.stringify(result)).not.toContain('secret-token');expect(JSON.stringify(result)).not.toContain('accessToken');
  });
  it('não consulta analytics de WABA incompatível',async()=>{
    const prisma:any={channel:{findFirst:jest.fn().mockResolvedValue({id:'channel',config:{phoneNumberId:'123',wabaId:'456',accessToken:seal('token','meta:123')}})}};
    request.mockResolvedValue({data:[{id:'foreign'}]});
    await expect(new MetaCostsService(prisma).get('company','channel',new Date().toISOString().slice(0,7))).rejects.toThrow('nao foi localizado');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('preserva configurações ao vincular WABA e não devolve credenciais',async()=>{
    const config={phoneNumberId:'123',accessToken:seal('token','meta:123'),onlyCustomerInitiated:true};
    const channel={id:'channel',config};
    const prisma:any={channel:{findFirst:jest.fn().mockResolvedValue(channel),update:jest.fn()},$queryRaw:jest.fn()};
    prisma.$transaction=(fn:any)=>fn(prisma);request.mockResolvedValue({data:[{id:'123'}]});
    expect(await new MetaCostsService(prisma).configure('company','channel','456')).toEqual({updated:true});
    expect(prisma.channel.update).toHaveBeenCalledWith({where:{id:'channel'},data:{config:{...config,wabaId:'456'}}});
  });
  it('não sobrescreve token que mudou durante validação da conta',async()=>{
    const config={phoneNumberId:'123',accessToken:seal('old','meta:123')};
    const prisma:any={channel:{findFirst:jest.fn().mockResolvedValueOnce({config}).mockResolvedValueOnce({config:{...config,accessToken:seal('new','meta:123')}}),update:jest.fn()},$queryRaw:jest.fn()};
    prisma.$transaction=(fn:any)=>fn(prisma);request.mockResolvedValue({data:[{id:'123'}]});
    await expect(new MetaCostsService(prisma).configure('company','channel','456')).rejects.toThrow('conexao mudou');
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

});
