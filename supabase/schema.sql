-- AttendanceHR schema. Run in Supabase SQL editor (or as migration 0001).
-- Tenant isolation lives here, in RLS. App code never filters by organization_id for security.

create extension if not exists pgcrypto;

create type member_role   as enum ('employee','admin');          -- org-level roles
create type org_status    as enum ('active','suspended');
create type verify_status as enum ('verified','out_of_range','low_accuracy','no_location');
create type approval      as enum ('pending','approved','rejected');

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_price numeric(10,2) not null default 0,
  annual_price  numeric(10,2) not null default 0,
  employee_limit int not null,
  is_active boolean not null default true
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_email text,
  company_address text,
  status org_status not null default 'active',
  plan_id uuid references subscription_plans(id),
  -- attendance rules (MVP: four knobs, per org)
  timezone text not null default 'Asia/Colombo',
  expected_start time not null default '09:00',
  expected_end   time not null default '17:30',
  grace_minutes  int  not null default 15,
  min_hours numeric(4,2) not null default 8,
  max_accuracy_m int not null default 100,   -- reject GPS fixes worse than this
  created_at timestamptz not null default now()
);

-- platform owner; separate from org membership so super admin is never implicit
create table platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);

create table departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  unique (organization_id, name)
);

create table workplaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address text,
  latitude  double precision not null check (latitude  between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  permitted_radius_m int not null default 100 check (permitted_radius_m > 0),
  is_active boolean not null default true
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role member_role not null default 'employee',
  department_id uuid references departments(id) on delete set null,
  workplace_id  uuid references workplaces(id)  on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on organization_members (user_id);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id uuid not null references organization_members(id) on delete cascade,
  workplace_id uuid references workplaces(id) on delete set null,
  work_date date not null,                    -- org-local date, set server side
  clock_in_at  timestamptz not null default now(),
  clock_out_at timestamptz,
  clock_in_lat double precision, clock_in_lng double precision, clock_in_accuracy_m numeric(8,2),
  clock_in_distance_m numeric(10,2), clock_in_status verify_status not null default 'no_location',
  clock_out_lat double precision, clock_out_lng double precision, clock_out_accuracy_m numeric(8,2),
  clock_out_distance_m numeric(10,2), clock_out_status verify_status,
  is_late boolean not null default false,
  device_info text,
  created_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
-- one open session per member: blocks duplicate clock-in without app-level locking
create unique index attendance_one_open on attendance_records (member_id) where clock_out_at is null;
create index on attendance_records (organization_id, work_date);

create table attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id uuid not null references organization_members(id) on delete cascade,
  attendance_record_id uuid references attendance_records(id) on delete cascade,
  requested_change jsonb not null,
  reason text not null,
  status approval not null default 'pending',
  reviewed_by uuid references organization_members(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigserial primary key,
  organization_id uuid references organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text, entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from organization_members m
                 where m.organization_id = org and m.user_id = auth.uid() and m.is_active);
$fn$;

create or replace function is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from organization_members m
                 where m.organization_id = org and m.user_id = auth.uid()
                   and m.is_active and m.role = 'admin');
$fn$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$fn$;

create or replace function my_member_id(org uuid) returns uuid
language sql stable security definer set search_path = public as $fn$
  select id from organization_members
  where organization_id = org and user_id = auth.uid() and is_active;
$fn$;

-- metres between two points; good enough at office scale, no PostGIS
create or replace function distance_m(lat1 double precision, lng1 double precision,
                                      lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $fn$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2-lng1)/2), 2)));
$fn$;

-- ---------- RLS ----------
alter table organizations          enable row level security;
alter table organization_members   enable row level security;
alter table departments            enable row level security;
alter table workplaces             enable row level security;
alter table attendance_records     enable row level security;
alter table attendance_corrections enable row level security;
alter table audit_logs             enable row level security;
alter table subscription_plans     enable row level security;
alter table platform_admins        enable row level security;

create policy org_read   on organizations for select using (is_member(id) or is_platform_admin());
create policy org_admin  on organizations for update using (is_org_admin(id) or is_platform_admin());
create policy org_create on organizations for insert with check (is_platform_admin());

create policy mem_read   on organization_members for select
  using (user_id = auth.uid() or is_org_admin(organization_id));
create policy mem_write  on organization_members for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

create policy dept_read  on departments for select using (is_member(organization_id));
create policy dept_write on departments for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

create policy wp_read    on workplaces for select using (is_member(organization_id));
create policy wp_write   on workplaces for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

-- employees see only their own rows; admins see the org. Platform admin: deliberately absent.
create policy att_read on attendance_records for select
  using (member_id = my_member_id(organization_id) or is_org_admin(organization_id));
create policy att_insert on attendance_records for insert
  with check (member_id = my_member_id(organization_id));
create policy att_update on attendance_records for update
  using (member_id = my_member_id(organization_id) or is_org_admin(organization_id));

create policy corr_read  on attendance_corrections for select
  using (member_id = my_member_id(organization_id) or is_org_admin(organization_id));
create policy corr_insert on attendance_corrections for insert
  with check (member_id = my_member_id(organization_id));
create policy corr_review on attendance_corrections for update
  using (is_org_admin(organization_id));

create policy audit_read  on audit_logs for select
  using (is_org_admin(organization_id) or is_platform_admin());
create policy plans_read  on subscription_plans for select using (true);
create policy plans_write on subscription_plans for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy padmin_read on platform_admins for select using (is_platform_admin());

insert into subscription_plans (name, monthly_price, annual_price, employee_limit) values
  ('Starter',  1000,  10000,  10),
  ('Business', 2500,  25000,  30),
  ('Growth',   6000,  60000, 100);
