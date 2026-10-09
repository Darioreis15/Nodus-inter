import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StartConversationDto } from './start-conversation.dto';
const channelId = '11111111-1111-4111-8111-111111111111';
describe('Telefone de nova conversa', () => {
  it.each([
    ['(31) 99999-9999','5531999999999'], ['31 3333-4444','553133334444'],
    ['+55 (31) 99999-9999','5531999999999'], ['5531999999999','5531999999999'],
    ['+1 (646) 589-4168','16465894168'], ['+351 912 345 678','351912345678'],
  ])('normaliza %s', (phone, expected) => {
    const dto = plainToInstance(StartConversationDto,{channelId,phone});
    expect(dto.phone).toBe(expected); expect(validateSync(dto)).toHaveLength(0);
  });
  it.each(['99999-9999','abc31999999999','++5531999999999','351912345678','+012345678','+1234567890123456',null,123])('rejeita entrada invalida %s', phone => {
    const dto = plainToInstance(StartConversationDto,{channelId,phone});
    expect(validateSync(dto).some(e => e.property === 'phone')).toBe(true);
  });
});
