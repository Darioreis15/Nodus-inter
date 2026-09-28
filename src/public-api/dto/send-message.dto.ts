import { MaxLength, IsString, MinLength } from 'class-validator';

export class PublicSendMessageDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(1)
  text: string;
}
