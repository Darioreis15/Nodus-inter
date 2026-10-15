import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PasswordBytes } from '../security/password';

export class CreateCompanyDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(200) companyName: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(200) adminName: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) adminEmail: string;
  @IsUUID() planId: string;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(4096) @PasswordBytes() temporaryPassword?: string;
  @IsBoolean() sendInvitation: boolean;
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['CREATE_COMPANY']) confirmation: string;
}
