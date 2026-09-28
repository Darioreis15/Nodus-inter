import { MaxLength, IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export enum ChannelTypeDto {
  QR_EVOLUTION = 'QR_EVOLUTION',
  OFFICIAL_META = 'OFFICIAL_META',
}

export class CreateChannelDto {
  @IsString()
  @MaxLength(4096)
  @MinLength(2)
  name: string;

  @IsEnum(ChannelTypeDto)
  type: ChannelTypeDto;

  // Obrigatorios apenas quando type = OFFICIAL_META
  @ValidateIf((dto) => dto.type === ChannelTypeDto.OFFICIAL_META)
  @IsString()
  @MaxLength(4096)
  phoneNumberId?: string;

  @ValidateIf((dto) => dto.type === ChannelTypeDto.OFFICIAL_META)
  @IsString()
  @MaxLength(4096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  wabaId?: string;
}
