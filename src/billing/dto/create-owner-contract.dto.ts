import { IsEmail, IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class CreateOwnerContractDto {
  @IsString() @Matches(/^(?:\d{11}|\d{14})$/) cpfCnpj: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsUUID() expectedPlanId: string;
  @IsInt() @Min(500) expectedPriceCents: number;
  @IsString() @Matches(/^\d{4}-(?:0[1-9]|1[0-2])$/) expectedStartMonth: string;
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['CREATE_CONTRACT']) confirmation: string;
}
