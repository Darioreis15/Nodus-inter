import { PasswordBytes } from '../../security/password';
import { MaxLength, IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(1)
  @PasswordBytes()
  password: string;
}
