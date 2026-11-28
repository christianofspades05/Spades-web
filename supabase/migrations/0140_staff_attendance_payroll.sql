-- =============================================================================
-- Staff Attendance & Payroll (v1)
--
-- Who is paid lives in payroll_employees rather than staff_users directly:
-- staff_users.auth_user_id is NOT NULL (every row is an admin login), but
-- some paid staff have no login — the owner logs their time by hand. An
-- employee optionally links to a staff_users row so that person can clock
-- themselves in/out.
--
-- Access: every table has RLS enabled with NO policies, so the anon/auth
-- roles see nothing; all reads/writes go through server functions using the
-- service-role client (src/server/admin/attendance.ts, payroll.ts), which
-- enforce "staff see/insert only their own shift" and "only the payroll
-- owner (staff_users.can_manage_payroll) sees everyone + payroll". The lock
-- rules (finalized/paid periods are read-only) are enforced below by
-- triggers, so they hold even for the service role.
--
-- All day boundaries are Asia/Manila: attendance_logs.work_date is the
-- Manila calendar date of clock_in_at (a shift 22:00→06:00 belongs to the
-- day it started).
-- =============================================================================

-- Only the store owner sees payroll; set per staff row (not by role) because
-- several accounts share super_admin. Set it by hand for the owner's row.
alter table staff_users
  add column can_manage_payroll boolean not null default false;

create type staff_pay_type as enum ('hourly', 'monthly');
create type attendance_source as enum ('self', 'manual');
create type payroll_period_status as enum ('draft', 'finalized', 'paid');
create type attendance_day_mark_kind as enum ('holiday', 'leave');

-- -----------------------------------------------------------------------------
-- payroll_employees
-- -----------------------------------------------------------------------------
create table payroll_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  staff_user_id uuid unique references staff_users (id) on delete set null,
  -- Deactivated staff keep their history but can't clock in.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- staff_pay_profiles — versioned; saving a change closes the current row
-- (effective_to = new effective_from - 1) and inserts a new one, so past
-- payroll never changes when a rate does.
-- -----------------------------------------------------------------------------
create table staff_pay_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references payroll_employees (id) on delete cascade,
  pay_type staff_pay_type not null,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  monthly_salary_cents integer check (monthly_salary_cents is null or monthly_salary_cents >= 0),
  -- 6 → daily-rate factor 313, 5 → 261.
  work_days_per_week integer not null default 6 check (work_days_per_week in (5, 6)),
  -- Days off, 0 = Sunday .. 6 = Saturday (Manila). Used for absences.
  rest_days smallint[] not null default '{0}',
  scheduled_start time,
  scheduled_hours_per_day numeric(4, 2) not null default 8 check (scheduled_hours_per_day > 0),
  unpaid_break_minutes integer not null default 60 check (unpaid_break_minutes >= 0),
  late_grace_minutes integer not null default 10 check (late_grace_minutes >= 0),
  -- Monthly staff only: deduct late + undertime minutes.
  deduct_lates boolean not null default true,
  overtime_enabled boolean not null default false,
  overtime_multiplier numeric(4, 2) not null default 1.25 check (overtime_multiplier > 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pay_type <> 'hourly' or hourly_rate_cents is not null),
  check (pay_type <> 'monthly' or monthly_salary_cents is not null),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index staff_pay_profiles_one_current
  on staff_pay_profiles (employee_id) where effective_to is null;
create index staff_pay_profiles_employee_idx
  on staff_pay_profiles (employee_id, effective_from);

-- -----------------------------------------------------------------------------
-- attendance_logs
-- -----------------------------------------------------------------------------
create table attendance_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references payroll_employees (id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  work_date date generated always as ((clock_in_at at time zone 'Asia/Manila')::date) stored,
  -- Owner override of the unpaid break for this shift (null = profile rule).
  break_minutes integer check (break_minutes is null or break_minutes >= 0),
  source attendance_source not null default 'self',
  note text,
  edited_by uuid references staff_users (id) on delete set null,
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);
-- No double clock-in.
create unique index attendance_logs_one_open_shift
  on attendance_logs (employee_id) where clock_out_at is null;
create index attendance_logs_employee_date_idx
  on attendance_logs (employee_id, work_date);
create index attendance_logs_work_date_idx on attendance_logs (work_date);
create index attendance_logs_edited_by_idx on attendance_logs (edited_by);

-- -----------------------------------------------------------------------------
-- attendance_day_marks — owner-marked holidays (employee_id null = everyone)
-- and leave days, skipped when counting absences.
-- -----------------------------------------------------------------------------
create table attendance_day_marks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references payroll_employees (id) on delete cascade,
  mark_date date not null,
  kind attendance_day_mark_kind not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index attendance_day_marks_unique
  on attendance_day_marks (coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), mark_date);
create index attendance_day_marks_date_idx on attendance_day_marks (mark_date);

-- -----------------------------------------------------------------------------
-- payroll_periods — semi-monthly: 1–15 and 16–end of month.
-- -----------------------------------------------------------------------------
create table payroll_periods (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  status payroll_period_status not null default 'draft',
  computed_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid references staff_users (id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (start_date, end_date),
  check (end_date >= start_date)
);
create index payroll_periods_finalized_by_idx on payroll_periods (finalized_by);

-- -----------------------------------------------------------------------------
-- payroll_items — one per employee per period, rates snapshotted.
-- -----------------------------------------------------------------------------
create table payroll_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references payroll_periods (id) on delete cascade,
  employee_id uuid not null references payroll_employees (id) on delete cascade,
  pay_type staff_pay_type not null,
  rate_snapshot_cents integer not null,
  days_worked integer not null default 0,
  regular_hours numeric(8, 2) not null default 0,
  overtime_hours numeric(8, 2) not null default 0,
  late_minutes integer not null default 0,
  undertime_minutes integer not null default 0,
  absent_days integer not null default 0,
  base_pay_cents integer not null default 0,
  overtime_pay_cents integer not null default 0,
  late_deduction_cents integer not null default 0,
  undertime_deduction_cents integer not null default 0,
  absence_deduction_cents integer not null default 0,
  -- [{label, amount_cents}] — bonus/holiday pay +, cash advance/SSS/PhilHealth/Pag-IBIG/tax −.
  adjustments jsonb not null default '[]'::jsonb,
  gross_pay_cents integer not null default 0,
  net_pay_cents integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index payroll_items_employee_idx on payroll_items (employee_id);

-- -----------------------------------------------------------------------------
-- Locks: finalized/paid periods are read-only for everyone.
-- -----------------------------------------------------------------------------
create or replace function payroll_date_is_locked(d date)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from payroll_periods p
    where p.status <> 'draft' and d between p.start_date and p.end_date
  );
$$;

create or replace function attendance_logs_lock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and payroll_date_is_locked(old.work_date) then
    raise exception 'This shift is in a finalized payroll period and can''t be changed'
      using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and payroll_date_is_locked(((new.clock_in_at at time zone 'Asia/Manila')::date)) then
    raise exception 'That date is in a finalized payroll period and can''t be changed'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger attendance_logs_lock_guard
  before insert or update or delete on attendance_logs
  for each row execute function attendance_logs_lock_guard();

create or replace function payroll_items_lock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  st payroll_period_status;
begin
  select status into st from payroll_periods
  where id = case when tg_op = 'DELETE' then old.period_id else new.period_id end;
  if st is not null and st <> 'draft' then
    raise exception 'This payroll period is finalized and can''t be changed'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payroll_items_lock_guard
  before insert or update or delete on payroll_items
  for each row execute function payroll_items_lock_guard();

-- Allowed transitions: draft → finalized, finalized → paid. Nothing else
-- may change once a period leaves draft.
create or replace function payroll_periods_lock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A finalized payroll period can''t be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'paid' then
    raise exception 'This payroll period is already paid' using errcode = 'P0001';
  end if;
  if old.status = 'finalized' and not (
    new.status = 'paid'
    and new.start_date = old.start_date and new.end_date = old.end_date
  ) then
    raise exception 'This payroll period is finalized and can''t be changed' using errcode = 'P0001';
  end if;
  if new.status = 'paid' and old.status <> 'finalized' then
    raise exception 'Finalize the period before marking it paid' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payroll_periods_lock_guard
  before update or delete on payroll_periods
  for each row execute function payroll_periods_lock_guard();

alter table payroll_employees enable row level security;
alter table staff_pay_profiles enable row level security;
alter table attendance_logs enable row level security;
alter table attendance_day_marks enable row level security;
alter table payroll_periods enable row level security;
alter table payroll_items enable row level security;
