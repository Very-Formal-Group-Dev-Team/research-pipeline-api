export interface Evaluations {
  id: string;
  defense_id: string;
  project_id: string;
  panelist_id: string;
  criterion_id: string;
  score: number;
  comments: string;
  created_at?: Date;
}

export default Evaluations;
