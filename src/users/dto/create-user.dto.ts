import { MaxLength, IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(['ADMIN', 'AGENT'])
  role: 'ADMIN' | 'AGENT';
}
