import { IsString, MinLength } from 'class-validator';

export class PublicSendMessageDto {
  @IsString()
  @MinLength(1)
  text: string;
}
