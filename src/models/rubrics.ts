import { DefenseTypeEnum } from './defenses';

export interface Rubric {
  id: string;
  name: string;
  defense_type: DefenseTypeEnum;
  created_by: string;
  created_at?: Date;
}

export default Rubric;
