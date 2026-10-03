import { PasswordBytes } from '../../security/password';
import { Transform } from 'class-transformer';
import { IsOptional, MaxLength, IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  name: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  email: string;

  @IsEnum(['ADMIN', 'AGENT'])
  role: 'ADMIN' | 'AGENT';

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(4096)
  @PasswordBytes()
  temporaryPassword?: string;
}
