import { IsUUID, ValidateIf } from 'class-validator';
export class ConversationDepartmentDto {
  @ValidateIf((_object, value) => value !== null) @IsUUID() departmentId: string | null;
}
