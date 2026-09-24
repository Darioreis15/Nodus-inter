import { IsEnum } from 'class-validator';

export enum ConversationStatusDto {
  OPEN = 'OPEN',
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
}

export class UpdateConversationStatusDto {
  @IsEnum(ConversationStatusDto)
  status: ConversationStatusDto;
}
