import { PasswordBytes } from '../../security/password';
import { MaxLength, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(4096)
  currentPassword: string;

  @IsString()
  @MaxLength(4096)
  @MinLength(12)
  @PasswordBytes()
  newPassword: string;
}
