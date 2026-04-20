export interface RubricCriterion {
  id: string;
  rubric_id: string;
  criterion_name: string;
  description: string;
  weight: number;
  max_score: number;
  order: number;
}

export default RubricCriterion;
