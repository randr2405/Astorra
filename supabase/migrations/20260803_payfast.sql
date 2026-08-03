-- PayFast subscription support

alter table businesses
  add column if not exists payfast_token text,
  add column if not exists subscription_status text not null default 'none';
  -- subscription_status: 'none' | 'active' | 'failed' | 'cancelled'

create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null,
  pf_payment_id text unique,
  token text,
  amount numeric(10, 2) not null default 0,
  status text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_payments_business_id_idx
  on subscription_payments(business_id);

-- RLS: businesses can read their own subscription history; all writes go
-- through the edge functions using the service role key, which bypasses RLS.
alter table subscription_payments enable row level security;

create policy "Users can view their own business's payments"
  on subscription_payments for select
  using (
    business_id in (
      select business_id from users where firebase_uid = auth.jwt() ->> 'sub'
    )
  );