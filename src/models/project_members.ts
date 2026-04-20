export type MemberRoleEnum = 'leader' | 'member' | 'adviser';
export type MemberStatusEnum = 'pending' | 'accepted' | 'declined';

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: MemberRoleEnum;
  status: MemberStatusEnum;
  invited_at?: Date;
  responded_at?: Date;
}

export default ProjectMember;
