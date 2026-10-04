import { MaxLength, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateAutoReplyDto {
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  message?: string;
}
