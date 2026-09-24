import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAutoReplyDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  message?: string;
}
