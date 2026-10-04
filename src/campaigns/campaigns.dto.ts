import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { TemplateMessageDto } from '../conversations/dto/start-conversation.dto';
export class CampaignRecipientDto {
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()+-]/g, '') : value)
  @Matches(/^\d{8,15}$/) phone: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Matches(/^https:\/\/[^\s]+$/) @MaxLength(1500) link?: string;
  @IsOptional() @IsString() @MaxLength(80) value?: string;
}
export class CampaignStepDto {
  @IsInt() @Min(0) @Max(525600) delayMinutes: number;
  @IsIn(['TEXT', 'TEMPLATE']) type: 'TEXT' | 'TEMPLATE';
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) text?: string;
  @IsOptional() @ValidateNested() @Type(() => TemplateMessageDto) template?: TemplateMessageDto;
}
export class CampaignDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsUUID() channelId: string;
  @Matches(/^[a-zA-Z0-9_.:-]{8,100}$/) requestKey: string;
  @IsDateString() @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) scheduledAt: string;
  @IsBoolean() consentConfirmed: boolean;
  @IsBoolean() stopOnReply: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CampaignRecipientDto) recipients: CampaignRecipientDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => CampaignStepDto) steps: CampaignStepDto[];
}
export class CampaignStateDto { @IsIn(['ACTIVE','PAUSED','CANCELLED']) state: 'ACTIVE' | 'PAUSED' | 'CANCELLED'; }
