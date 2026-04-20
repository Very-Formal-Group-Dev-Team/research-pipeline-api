export type AuthProviderEnum = 'google' | 'email';

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  auth_provider: AuthProviderEnum;
  created_at?: Date;
  updated_at?: Date;
  status: number;
  status_text?: string;
}

export default User;
