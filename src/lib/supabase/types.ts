export type Database = {
  public: {
    Tables: {
      vault_keys: {
        Row: {
          user_id: string;
          salt: string;
          verifier_iv: string;
          verifier_ciphertext: string;
          version: number;
          created_at: string;
        };
        Insert: {
          user_id: string;
          salt: string;
          verifier_iv: string;
          verifier_ciphertext: string;
          version?: number;
        };
        Update: {
          salt?: string;
          verifier_iv?: string;
          verifier_ciphertext?: string;
          version?: number;
        };
        Relationships: [];
      };
      vault_items: {
        Row: {
          id: string;
          user_id: string;
          ciphertext: string;
          iv: string;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          ciphertext: string;
          iv: string;
          version?: number;
        };
        Update: {
          ciphertext?: string;
          iv?: string;
          version?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_credentials: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          transports: string[];
          prf_salt: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          transports?: string[];
          prf_salt: string;
          last_used_at?: string | null;
        };
        Update: {
          public_key?: string;
          transports?: string[];
          prf_salt?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
