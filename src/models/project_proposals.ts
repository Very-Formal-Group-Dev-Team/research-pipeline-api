export type ProposalStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'revision_requested';

export interface ProjectProposal {
  id: string;
  project_id: string;
  title: string;
  abstract: string;
  description: string;
  keywords: string[];
  created_by: string;
  adviser_id: string;
  status: ProposalStatus;
  created_at?: Date;
  updated_at?: Date;
}

export default ProjectProposal;
