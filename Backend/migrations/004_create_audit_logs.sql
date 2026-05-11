-- Create audit_logs table for system activity tracking
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  username TEXT NOT NULL,
  role TEXT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT DEFAULT 'success',
  ip_address TEXT,
  description TEXT,
  changes_before JSONB,
  changes_after JSONB,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on timestamp for better query performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);

-- Create index on username for faster filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON public.audit_logs(username);

-- Create index on module for faster filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON public.audit_logs(module);

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON public.audit_logs(status);
