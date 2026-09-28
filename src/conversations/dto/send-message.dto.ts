import { MaxLength, IsString, MinLength } from 'class-validator';

export class SendConversationMessageDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(1)
  text: string;
}
