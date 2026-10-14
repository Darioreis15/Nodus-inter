import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
export class CancelSubscriptionDto {
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['CANCEL']) confirmation: string;
}
