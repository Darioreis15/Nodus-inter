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

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(12)
  @PasswordBytes()
  password: string;
}
