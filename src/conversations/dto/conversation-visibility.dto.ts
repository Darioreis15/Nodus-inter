import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
export class ConversationVisibilityDto {
  @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all',{each:true}) ids: string[];
}
export class TransferConversationDto {
  @IsUUID() userId: string;
}
