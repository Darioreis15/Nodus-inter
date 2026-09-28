import { MaxLength, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class SubscribeDto {
  @IsString()
  @MaxLength(4096)
  @Length(11, 14) // CPF (11) ou CNPJ (14), so digitos
  cpfCnpj: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
