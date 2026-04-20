export interface DefenseResult {
  id: string; // uuid
  defense_id: string; // uuid
  project_id: string; // uuid
  overall_score: number; // numeric
  verdict: 'pass' | 'fail' | 'conditional_pass'; // verdict_enum
  recommendations: string; // text
  finalized_at: Date; // timestamptz
  created_at?: Date;
  updated_at?: Date;
}

export default DefenseResult;