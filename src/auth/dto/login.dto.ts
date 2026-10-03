import { Transform } from 'class-transformer';
import { PasswordBytes } from '../../security/password';
import { MaxLength, IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(1)
  @PasswordBytes()
  password: string;
}
