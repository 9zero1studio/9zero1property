-- 9Zero1Property MVP schema. Run in Supabase SQL Editor as project owner.
create extension if not exists pgcrypto;

create type public.app_role as enum ('member', 'admin');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.request_kind as enum ('redemption', 'mining_package');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'member',
  points bigint not null default 0 check (points >= 0),
  mining_power integer not null default 1 check (mining_power >= 1),
  last_checkin_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mining','redemption','admin_adjustment','refund')),
  points_delta bigint not null,
  description text not null,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  points_cost bigint not null check (points_cost > 0),
  reward_type text not null default 'other' check (reward_type in ('coupon','physical','cash_request','digital_asset_request','other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.mining_packages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price_label text not null default 'สอบถามแอดมิน',
  power integer not null check (power >= 1),
  duration_days integer not null check (duration_days >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.member_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_type public.request_kind not null,
  reward_id uuid references public.rewards(id),
  package_id uuid references public.mining_packages(id),
  title text not null,
  points_cost bigint,
  price_label text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint request_target_check check (
    (request_type = 'redemption' and reward_id is not null and package_id is null and points_cost is not null)
    or
    (request_type = 'mining_package' and package_id is not null and reward_id is null)
  )
);

create index point_transactions_user_created_idx on public.point_transactions(user_id, created_at desc);
create index member_requests_status_created_idx on public.member_requests(status, created_at desc);

-- Create profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name','สมาชิก'));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.point_transactions enable row level security;
alter table public.rewards enable row level security;
alter table public.mining_packages enable row level security;
alter table public.member_requests enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;


-- Members can read only their profile and own history; never directly update points/role.
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "read own transactions" on public.point_transactions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "read active rewards" on public.rewards for select to authenticated using (active or public.is_admin());
create policy "read active packages" on public.mining_packages for select to authenticated using (active or public.is_admin());
create policy "read own requests" on public.member_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Avoid direct client writes to sensitive tables. RLS plus grants are defense in depth.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.point_transactions from anon, authenticated;
revoke insert, update, delete on public.rewards from anon, authenticated;
revoke insert, update, delete on public.mining_packages from anon, authenticated;
revoke insert, update, delete on public.member_requests from anon, authenticated;

create or replace function public.claim_mining_points()
returns void language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_profile public.profiles%rowtype; v_amount integer; v_key text;
begin
  if v_user is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  select * into v_profile from public.profiles where id = v_user for update;
  if not found then raise exception 'ไม่พบข้อมูลสมาชิก'; end if;
  if v_profile.last_checkin_at is not null and v_profile.last_checkin_at > now() - interval '24 hours' then
    raise exception 'ยังไม่ครบ 24 ชั่วโมง'; end if;
  v_amount := greatest(1, v_profile.mining_power);
  update public.profiles set points = points + v_amount, last_checkin_at = now() where id = v_user;
  v_key := 'mine:' || v_user::text || ':' || floor(extract(epoch from now()) / 86400)::text;
  insert into public.point_transactions(user_id,kind,points_delta,description,idempotency_key)
  values(v_user,'mining',v_amount,'รับคะแนนจากการขุด ' || v_amount || ' คะแนน',v_key);
exception when unique_violation then
  raise exception 'รับคะแนนรอบนี้แล้ว กรุณารอรอบถัดไป';
end;
$$;

create or replace function public.request_redemption(p_reward_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_reward public.rewards%rowtype; v_req uuid;
begin
  if v_user is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  select * into v_reward from public.rewards where id=p_reward_id and active=true;
  if not found then raise exception 'ไม่พบรางวัลหรือปิดรับแลกแล้ว'; end if;
  perform 1 from public.profiles where id=v_user and points >= v_reward.points_cost for update;
  if not found then raise exception 'คะแนนไม่เพียงพอ'; end if;
  update public.profiles set points=points-v_reward.points_cost where id=v_user;
  insert into public.point_transactions(user_id,kind,points_delta,description)
  values(v_user,'redemption',-v_reward.points_cost,'ส่งคำขอแลกรางวัล: '||v_reward.title);
  insert into public.member_requests(user_id,request_type,reward_id,title,points_cost)
  values(v_user,'redemption',v_reward.id,v_reward.title,v_reward.points_cost) returning id into v_req;
  return v_req;
end;
$$;

create or replace function public.request_mining_package(p_package_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_package public.mining_packages%rowtype; v_req uuid;
begin
  if v_user is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  select * into v_package from public.mining_packages where id=p_package_id and active=true;
  if not found then raise exception 'ไม่พบแพ็กเกจหรือปิดขายแล้ว'; end if;
  insert into public.member_requests(user_id,request_type,package_id,title,price_label)
  values(v_user,'mining_package',v_package.id,v_package.title,v_package.price_label) returning id into v_req;
  return v_req;
end;
$$;

create or replace function public.admin_create_reward(p_title text, p_description text, p_points_cost bigint, p_reward_type text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  if length(trim(p_title)) < 2 or p_points_cost < 1 then raise exception 'ข้อมูลรางวัลไม่ถูกต้อง'; end if;
  insert into public.rewards(title,description,points_cost,reward_type)
  values(trim(p_title),nullif(trim(p_description),''),p_points_cost,p_reward_type) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_create_package(p_title text, p_description text, p_price_label text, p_power integer, p_duration_days integer)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  if length(trim(p_title)) < 2 or p_power < 1 or p_duration_days < 1 then raise exception 'ข้อมูลแพ็กเกจไม่ถูกต้อง'; end if;
  insert into public.mining_packages(title,description,price_label,power,duration_days)
  values(trim(p_title),nullif(trim(p_description),''),coalesce(nullif(trim(p_price_label),''),'สอบถามแอดมิน'),p_power,p_duration_days) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_list_users()
returns table(id uuid,email text,display_name text,role public.app_role,points bigint,mining_power integer,created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  return query select p.id,p.email,p.display_name,p.role,p.points,p.mining_power,p.created_at from public.profiles p order by p.created_at desc limit 500;
end;
$$;

create or replace function public.admin_list_requests()
returns table(id uuid,user_id uuid,email text,request_type public.request_kind,title text,description text,points_cost bigint,price_label text,status public.request_status,created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  return query select mr.id,mr.user_id,p.email,mr.request_type,mr.title,
    case when mr.request_type='redemption' then r.description else mp.description end,
    mr.points_cost,mr.price_label,mr.status,mr.created_at
  from public.member_requests mr join public.profiles p on p.id=mr.user_id
  left join public.rewards r on r.id=mr.reward_id left join public.mining_packages mp on mp.id=mr.package_id
  order by mr.created_at desc limit 500;
end;
$$;

create or replace function public.admin_review_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare v_req public.member_requests%rowtype; v_user public.profiles%rowtype; v_package public.mining_packages%rowtype;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  select * into v_req from public.member_requests where id=p_request_id for update;
  if not found then raise exception 'ไม่พบคำขอ'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกตรวจสอบแล้ว'; end if;
  if p_approve then
    if v_req.request_type='mining_package' then
      select * into v_package from public.mining_packages where id=v_req.package_id;
      update public.profiles set mining_power=greatest(mining_power,v_package.power) where id=v_req.user_id;
    end if;
    update public.member_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id;
  else
    if v_req.request_type='redemption' then
      update public.profiles set points=points+v_req.points_cost where id=v_req.user_id;
      insert into public.point_transactions(user_id,kind,points_delta,description)
      values(v_req.user_id,'refund',v_req.points_cost,'คืนคะแนนจากคำขอที่ถูกปฏิเสธ: '||v_req.title);
    end if;
    update public.member_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id;
  end if;
end;
$$;

create or replace function public.admin_set_user_power(p_user_id uuid, p_power integer)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ผู้ดูแล'; end if;
  if p_power < 1 or p_power > 10000 then raise exception 'ค่าแรงขุดไม่ถูกต้อง'; end if;
  update public.profiles set mining_power=p_power where id=p_user_id;
  if not found then raise exception 'ไม่พบสมาชิก'; end if;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; explicitly restrict RPC access.
revoke all on function public.claim_mining_points() from public, anon;
revoke all on function public.request_redemption(uuid) from public, anon;
revoke all on function public.request_mining_package(uuid) from public, anon;
revoke all on function public.admin_create_reward(text,text,bigint,text) from public, anon;
revoke all on function public.admin_create_package(text,text,text,integer,integer) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_list_requests() from public, anon;
revoke all on function public.admin_review_request(uuid,boolean) from public, anon;
revoke all on function public.admin_set_user_power(uuid,integer) from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

grant execute on function public.claim_mining_points() to authenticated;
grant execute on function public.request_redemption(uuid) to authenticated;
grant execute on function public.request_mining_package(uuid) to authenticated;
grant execute on function public.admin_create_reward(text,text,bigint,text) to authenticated;
grant execute on function public.admin_create_package(text,text,text,integer,integer) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_requests() to authenticated;
grant execute on function public.admin_review_request(uuid,boolean) to authenticated;
grant execute on function public.admin_set_user_power(uuid,integer) to authenticated;

-- Optional starter rewards/packages; safe to run once.
insert into public.rewards(title,description,points_cost,reward_type) values
('คูปองส่วนลดตัวอย่าง','รายการทดสอบ แก้ไขได้จากฐานข้อมูล',100,'coupon'),
('ของรางวัลตัวอย่าง','คำขอจะถูกส่งให้แอดมินอนุมัติ',500,'physical');
insert into public.mining_packages(title,description,price_label,power,duration_days) values
('Bronze','เพิ่มแรงขุดเป็น 2 คะแนนต่อรอบ','สอบถามแอดมิน',2,30),
('Silver','เพิ่มแรงขุดเป็น 5 คะแนนต่อรอบ','สอบถามแอดมิน',5,30);
