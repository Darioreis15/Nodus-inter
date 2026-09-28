import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateMetaTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @Matches(/^\S+$/, { message: 'accessToken nao pode conter espacos; envie somente o token, sem Bearer.' })
  accessToken!: string;
}
