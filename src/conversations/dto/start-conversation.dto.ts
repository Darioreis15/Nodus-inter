import { normalizePhone } from './normalize-phone';
import { Transform } from 'class-transformer';
import { IsArray, ArrayMaxSize, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, IsBoolean } from 'class-validator';
export class StartConversationDto {
  @IsUUID() channelId: string;
  @Transform(({ value }) => normalizePhone(value))
  @Matches(/^[1-9]\d{7,14}$/, { message: 'Informe DDD e telefone brasileiro ou +DDI e numero para outros paises.' }) phone: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
export class ContactNameDto { @IsString() @MinLength(1) @MaxLength(120) name: string; }
export class StageDto { @IsUUID() stageId: string; }
export class TemplateMessageDto {
  @Matches(/^[a-z0-9_]{1,512}$/) name: string;
  @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) language: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) parameters: string[];
}
