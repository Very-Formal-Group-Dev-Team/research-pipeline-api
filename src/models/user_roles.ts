export type UserRoleEnum = 'student' | 'adviser' | 'panelist' | 'admin';

export interface UserRoles {
  id: string;
  user_id: string;
  role: UserRoleEnum;
  institution_id: string;
  created_at?: Date;
}

export default UserRoles;
