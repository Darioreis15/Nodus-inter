import { MaxLength, IsString, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  name: string;
}
