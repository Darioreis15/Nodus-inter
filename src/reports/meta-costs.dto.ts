import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';
export class MetaCostsQuery {
  @IsUUID() channelId: string;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month: string;
}
export class MetaAccountDto {
  @IsString() @MaxLength(32) @Matches(/^\d+$/) wabaId: string;
}
