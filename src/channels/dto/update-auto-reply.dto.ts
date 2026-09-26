import { MaxLength, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAutoReplyDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  message?: string;
}
