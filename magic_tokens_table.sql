-- Create magic_tokens table for storing temporary magic link tokens
CREATE TABLE IF NOT EXISTS magic_tokens (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(email)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email_token ON magic_tokens(email, token);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires_at ON magic_tokens(expires_at);

-- Add RLS policy if needed (adjust based on your security requirements)
ALTER TABLE magic_tokens ENABLE ROW LEVEL SECURITY;

-- Policy to allow service role to manage tokens
CREATE POLICY "Service role can manage magic tokens" ON magic_tokens
  FOR ALL USING (auth.role() = 'service_role');