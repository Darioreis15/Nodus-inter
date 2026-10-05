import { IsIn } from 'class-validator';
export class UpdateRoleDto {
  @IsIn(['ADMIN', 'AGENT']) role: 'ADMIN' | 'AGENT';
}
