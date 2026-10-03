import { Transform } from 'class-transformer';
import { IsArray, ArrayMaxSize, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, IsBoolean } from 'class-validator';
export class StartConversationDto {
  @IsUUID() channelId: string;
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()+-]/g, '') : value)
  @Matches(/^\d{8,15}$/) phone: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
export class ContactNameDto { @IsString() @MinLength(1) @MaxLength(120) name: string; }
export class StageDto { @IsUUID() stageId: string; }
export class TemplateMessageDto {
  @Matches(/^[a-z0-9_]{1,512}$/) name: string;
  @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) language: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) parameters: string[];
}
