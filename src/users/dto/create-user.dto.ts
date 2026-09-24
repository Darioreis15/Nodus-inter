import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(['ADMIN', 'AGENT'])
  role: 'ADMIN' | 'AGENT';
}
