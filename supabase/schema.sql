create extension if not exists pgcrypto;

create table if not exists public.workplaces(
 id uuid primary key default gen_random_uuid(), name text not null,
 latitude double precision not null, longitude double precision not null,
 radius_m integer not null default 80 check(radius_m between 10 and 1000), created_at timestamptz not null default now());

create table if not exists public.shifts(
 id uuid primary key default gen_random_uuid(), name text not null unique,
 start_time time not null, end_time time not null, break_minutes integer not null default 0,
 break_start time, tolerance_minutes integer not null default 15, active boolean not null default true,
 created_at timestamptz not null default now());

create sequence if not exists public.employee_registration_seq start 1001;
create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null, cpf text unique, phone text, registration text unique,
 role text not null default 'employee' check(role in('employee','admin')),
 active boolean not null default true, workplace_id uuid references public.workplaces(id),
 default_shift_id uuid references public.shifts(id), created_at timestamptz not null default now());

create table if not exists public.daily_schedules(
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id) on delete cascade,
 work_date date not null, shift_id uuid references public.shifts(id),
 occurrence text not null default 'work' check(occurrence in('work','folga','ferias','atestado','falta_justificada','outro')),
 notes text, unique(employee_id,work_date));

create table if not exists public.time_entries(
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 workplace_id uuid not null references public.workplaces(id), work_date date not null default ((now() at time zone 'America/Recife')::date),
 kind text not null check(kind in('entrada','saida_intervalo','retorno_intervalo','saida')),
 created_at timestamptz not null default now(), latitude double precision not null, longitude double precision not null,
 accuracy_m double precision, distance_m double precision, suspicious boolean not null default false,
 suspicious_reason text, selfie_path text, user_agent text,
 original_created_at timestamptz, edited_at timestamptz, edited_by uuid references public.profiles(id), edit_reason text);
create index if not exists idx_entries_employee_date on public.time_entries(employee_id,work_date,created_at);

create table if not exists public.timesheet_signatures(
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id) on delete cascade,
 period_start date not null, period_end date not null, signed_at timestamptz not null default now(),
 unique(employee_id,period_start,period_end));

insert into public.workplaces(name,latitude,longitude,radius_m)
select 'Ailton Hortifruti',-8.2929795,-34.9565964,80 where not exists(select 1 from public.workplaces);
insert into public.shifts(name,start_time,end_time,break_minutes,break_start,tolerance_minutes) values
('06:00–15:00 • 1h almoço','06:00','15:00',60,'10:00',15),
('09:00–19:00 • 2h almoço','09:00','19:00',120,'13:00',15),
('11:00–19:00 • sem almoço','11:00','19:00',0,null,15)
on conflict(name) do nothing;
insert into storage.buckets(id,name,public) values('punch-selfies','punch-selfies',false)
on conflict(id) do update set public=false;

alter table public.profiles enable row level security; alter table public.time_entries enable row level security;
alter table public.shifts enable row level security; alter table public.workplaces enable row level security;
alter table public.daily_schedules enable row level security; alter table public.timesheet_signatures enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active);$$;
drop policy if exists "profile own or admin" on public.profiles; create policy "profile own or admin" on public.profiles for select using(id=auth.uid() or public.is_admin());
drop policy if exists "entries own or admin" on public.time_entries; create policy "entries own or admin" on public.time_entries for select using(employee_id=auth.uid() or public.is_admin());
drop policy if exists "shifts authenticated" on public.shifts; create policy "shifts authenticated" on public.shifts for select to authenticated using(true);
drop policy if exists "workplaces authenticated" on public.workplaces; create policy "workplaces authenticated" on public.workplaces for select to authenticated using(true);
drop policy if exists "schedules own or admin" on public.daily_schedules; create policy "schedules own or admin" on public.daily_schedules for select using(employee_id=auth.uid() or public.is_admin());
drop policy if exists "signatures own or admin" on public.timesheet_signatures; create policy "signatures own or admin" on public.timesheet_signatures for select using(employee_id=auth.uid() or public.is_admin());
