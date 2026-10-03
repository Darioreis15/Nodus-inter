import { Transform } from 'class-transformer';
import { PasswordBytes } from '../../security/password';
import { MaxLength, IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterTenantDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  companyName: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  adminName: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  adminEmail: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(12)
  @PasswordBytes()
  password: string;
}
