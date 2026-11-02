-- All data is private. Only explicitly granted RPCs form the API.
create schema if not exists exam_private;
revoke all on schema exam_private from public, anon, authenticated;
create table exam_private.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('student','teacher')), full_name text not null,
 active boolean not null default true
);
create table exam_private.groups(id text primary key check(length(id) between 1 and 64), name text not null);
create table exam_private.students(
 id text primary key, auth_id uuid unique not null references exam_private.profiles(id) on delete cascade,
 login text unique not null check(login ~ '^[a-z0-9_][a-z0-9_.-]{1,63}$'),
 group_id text not null references exam_private.groups(id)
);
create table exam_private.modules(
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','open','closed','published','archived')),
 question_count int not null default 20 check(question_count between 1 and 200),
 seconds_per_question int not null default 30 check(seconds_per_question between 5 and 600),
 total_seconds int not null default 600 check(total_seconds between 30 and 86400),
 max_score numeric not null default 10 check(max_score>0 and max_score<=1000),
 selection_mode text not null default 'random' check(selection_mode in ('random','quotas')),
 quotas jsonb not null default '{}', created_at timestamptz not null default clock_timestamp(), published_at timestamptz
);
create table exam_private.module_groups(
 module_id uuid references exam_private.modules(id), group_id text references exam_private.groups(id),
 access boolean not null default false, window_start timestamptz, window_end timestamptz,
 primary key(module_id,group_id), check(window_end is null or window_start is null or window_end>window_start)
);
create table exam_private.questions(
 id uuid primary key default gen_random_uuid(), module_id uuid not null references exam_private.modules(id),
 external_id text not null, lecture text not null, difficulty text not null default 'normal',
 text text not null check(length(text) between 1 and 10000), options jsonb not null,
 correct int not null check(correct between 0 and 3), active boolean not null default true,
 version int not null default 1, unique(module_id,external_id), check(jsonb_array_length(options)=4)
);
-- Attempt question records are immutable snapshots: edits cannot alter grading.
create table exam_private.attempts(
 id uuid primary key default gen_random_uuid(), module_id uuid not null references exam_private.modules(id),
 student_id text not null references exam_private.students(id), group_id text not null,
 status text not null default 'active' check(status in ('active','finished')),
 question_count int not null, seconds_per_question int not null, max_score numeric not null,
 current_index int not null default 0, started_at timestamptz not null,
 deadline_at timestamptz not null, question_deadline timestamptz not null, finished_at timestamptz,
 unique(module_id,student_id)
);
create index attempts_active on exam_private.attempts(deadline_at) where status='active';
create index attempts_filter on exam_private.attempts(module_id,group_id,status);
create table exam_private.attempt_questions(
 attempt_id uuid references exam_private.attempts(id), position int not null,
 question_id uuid not null, version int not null, text text not null, options jsonb not null,
 correct_id uuid not null, primary key(attempt_id,position)
);
create table exam_private.answers(
 attempt_id uuid, position int, option_id uuid, correct boolean not null, received_at timestamptz not null,
 primary key(attempt_id,position), foreign key(attempt_id,position) references exam_private.attempt_questions(attempt_id,position)
);
create table exam_private.results(
 attempt_id uuid primary key references exam_private.attempts(id), correct_count int not null, score numeric not null
);
create table exam_private.commands(
 attempt_id uuid references exam_private.attempts(id), key uuid not null,
 position int not null, option_id uuid not null, outcome text not null, primary key(attempt_id,key)
);
create table exam_private.audit_logs(
 id bigint generated always as identity primary key, actor uuid, action text not null,
 target text, details jsonb not null default '{}', created_at timestamptz not null default clock_timestamp()
);
create table exam_private.rate_limits(actor uuid, bucket text, window_at timestamptz, count int not null, primary key(actor,bucket));
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='exam_private' loop
 execute format('alter table exam_private.%I enable row level security',t);
 end loop;
end $$;

create function exam_private.actor() returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from exam_private.profiles where id=auth.uid() and active) then raise exception 'Доступ запрещён' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function exam_private.teacher() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); begin
 if not exists(select 1 from exam_private.profiles where id=u and role='teacher') then raise exception 'Требуются права преподавателя' using errcode='42501'; end if;return u;
end $$;
create function exam_private.throttle(b text, lim int) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); n int; begin
 insert into exam_private.rate_limits values(u,b,clock_timestamp(),1)
 on conflict(actor,bucket) do update set count=case when exam_private.rate_limits.window_at < clock_timestamp()-interval '1 minute' then 1 else exam_private.rate_limits.count+1 end,
 window_at=case when exam_private.rate_limits.window_at < clock_timestamp()-interval '1 minute' then clock_timestamp() else exam_private.rate_limits.window_at end returning count into n;
 if n>lim then raise exception 'Слишком много запросов. Подождите минуту.' using errcode='P0001'; end if;
end $$;
create function public.my_profile() returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(p) from exam_private.profiles p where p.id=exam_private.actor();
$$;
create function public.student_modules() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); begin
 return coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('available',m.status='open' and mg.access and (mg.window_start is null or clock_timestamp()>=mg.window_start) and (mg.window_end is null or clock_timestamp()<mg.window_end),'attempt_id',a.id,'attempt_status',a.status) order by m.created_at desc)
 from exam_private.students s cross join exam_private.modules m
 left join exam_private.module_groups mg on mg.group_id=s.group_id and mg.module_id=m.id
 left join exam_private.attempts a on a.module_id=m.id and a.student_id=s.id
 where s.auth_id=u and m.status<>'draft' and (mg.module_id is not null or a.id is not null)), '[]');
end $$;
create function exam_private.reconcile(aid uuid) returns void language plpgsql security definer set search_path='' as $$
declare a exam_private.attempts; t timestamptz; n int; begin
 select * into strict a from exam_private.attempts where id=aid for update;
 if a.status='finished' then return; end if;
 t:=clock_timestamp();
 while a.current_index<a.question_count and (t>=a.question_deadline or t>=a.deadline_at) loop
  insert into exam_private.answers values(a.id,a.current_index,null,false,t) on conflict do nothing;
  a.current_index:=a.current_index+1;
  a.question_deadline:=least(a.question_deadline+make_interval(secs=>a.seconds_per_question),a.deadline_at);
 end loop;
 if a.current_index>=a.question_count then
  a.status:='finished';a.finished_at:=t;
  select count(*) filter(where correct) into n from exam_private.answers where attempt_id=aid;
  insert into exam_private.results values(aid,n,round(n*a.max_score/a.question_count,2)) on conflict do nothing;
 end if;
 update exam_private.attempts set current_index=a.current_index,question_deadline=a.question_deadline,status=a.status,finished_at=a.finished_at where id=aid;
end $$;
create function exam_private.view_attempt(aid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a exam_private.attempts; q exam_private.attempt_questions; m exam_private.modules; r exam_private.results; begin
 select * into strict a from exam_private.attempts where id=aid;
 select * into strict m from exam_private.modules where id=a.module_id;
 if a.status='finished' then
  select * into r from exam_private.results where attempt_id=aid;
  return jsonb_build_object('attempt_id',aid,'done',true,'title',m.title,'total',a.question_count,'server_now',clock_timestamp(),'attempt_deadline',a.deadline_at,'published',m.published_at is not null)
   || case when m.published_at is not null then jsonb_build_object('score',r.score,'correct',r.correct_count,'max_score',a.max_score) else '{}'::jsonb end;
 end if;
 select * into strict q from exam_private.attempt_questions where attempt_id=aid and position=a.current_index;
 return jsonb_build_object('attempt_id',aid,'done',false,'title',m.title,'index',a.current_index+1,'total',a.question_count,'question',q.text,'options',q.options,'server_now',clock_timestamp(),'question_deadline',a.question_deadline,'attempt_deadline',a.deadline_at);
end $$;
create function exam_private.own_attempt(aid uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); begin
 if not exists(select 1 from exam_private.attempts a join exam_private.students s on s.id=a.student_id where a.id=aid and s.auth_id=u) then raise exception 'Попытка недоступна' using errcode='42501';end if;
end $$;
create function public.attempt_start_or_resume(p_module_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); s exam_private.students; m exam_private.modules; a exam_private.attempts;
 q exam_private.questions; selected uuid[]:='{}'; item record; available int; needed int; pos int:=0;
 opts jsonb; cid uuid; oid uuid; i int; t timestamptz;
begin
 perform exam_private.throttle('start',30);
 select * into strict s from exam_private.students where auth_id=u;
 -- Shared module lock permits simultaneous starts and excludes close/publish/edit.
 select * into strict m from exam_private.modules where id=p_module_id for share;
 -- Serialize starts of the same student without locking unrelated students.
 perform 1 from exam_private.students where id=s.id for update;
 select * into a from exam_private.attempts where student_id=s.id and module_id=m.id for update;
 if found then perform exam_private.reconcile(a.id);return exam_private.view_attempt(a.id);end if;
 if m.status<>'open' or not exists(select 1 from exam_private.module_groups g where g.module_id=m.id and g.group_id=s.group_id and g.access and (g.window_start is null or clock_timestamp()>=g.window_start) and (g.window_end is null or clock_timestamp()<g.window_end)) then raise exception 'Приём для вашей группы закрыт';end if;
 if m.selection_mode='random' then
  select array_agg(id) into selected from (select id from exam_private.questions where module_id=m.id and active order by random() limit m.question_count) x;
 else
  for item in select key,value from jsonb_each_text(m.quotas) loop
   needed:=item.value::int;
   select selected||coalesce(array_agg(id),'{}'::uuid[]) into selected from (select id from exam_private.questions where module_id=m.id and active and lecture=item.key order by random() limit needed) x;
  end loop;
 end if;
 if coalesce(array_length(selected,1),0)<>m.question_count then raise exception 'Недостаточно вопросов в банке';end if;
 t:=clock_timestamp();
 insert into exam_private.attempts(module_id,student_id,group_id,question_count,seconds_per_question,max_score,started_at,deadline_at,question_deadline)
 values(m.id,s.id,s.group_id,m.question_count,m.seconds_per_question,m.max_score,t,t+make_interval(secs=>m.total_seconds),least(t+make_interval(secs=>m.seconds_per_question),t+make_interval(secs=>m.total_seconds))) returning * into a;
 for q in select * from exam_private.questions where id=any(selected) order by random() loop
  opts:='[]';cid:=null;
  for i in 0..3 loop oid:=gen_random_uuid();if i=q.correct then cid:=oid;end if;opts:=opts||jsonb_build_array(jsonb_build_object('id',oid,'text',q.options->>i));end loop;
  select jsonb_agg(value order by random()) into opts from jsonb_array_elements(opts);
  insert into exam_private.attempt_questions values(a.id,pos,q.id,q.version,q.text,opts,cid);pos:=pos+1;
 end loop;
 return exam_private.view_attempt(a.id);
end $$;
create function public.attempt_current(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform exam_private.own_attempt(p_attempt_id);perform exam_private.throttle('current',90);perform exam_private.reconcile(p_attempt_id);return exam_private.view_attempt(p_attempt_id);end $$;
create function public.attempt_submit_answer(p_attempt_id uuid,p_position int,p_option_id uuid,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a exam_private.attempts; q exam_private.attempt_questions; c exam_private.commands; outcome text; begin
 perform exam_private.own_attempt(p_attempt_id);perform exam_private.throttle('answer',90);
 select * into strict a from exam_private.attempts where id=p_attempt_id for update;
 select * into c from exam_private.commands where attempt_id=p_attempt_id and key=p_key;
 if found then
  if c.position<>p_position or c.option_id<>p_option_id then raise exception 'Ключ команды уже использован для другого ответа';end if;
  perform exam_private.reconcile(a.id);return exam_private.view_attempt(a.id)||jsonb_build_object('outcome',c.outcome);
 end if;
 perform exam_private.reconcile(a.id);select * into strict a from exam_private.attempts where id=a.id;
 if a.status='finished' or p_position<>a.current_index+1 then outcome:='expired_or_stale';
 else
  select * into strict q from exam_private.attempt_questions where attempt_id=a.id and position=a.current_index;
  if not exists(select 1 from jsonb_array_elements(q.options) o where (o->>'id')::uuid=p_option_id) then raise exception 'Недопустимый вариант';end if;
  -- Recheck after lock acquisition and all validation; use the server receive time.
  if clock_timestamp()>=a.question_deadline or clock_timestamp()>=a.deadline_at then
   perform exam_private.reconcile(a.id);outcome:='expired_or_stale';
  else
   insert into exam_private.answers values(a.id,a.current_index,p_option_id,p_option_id=q.correct_id,clock_timestamp());
   update exam_private.attempts set current_index=current_index+1,question_deadline=least(clock_timestamp()+make_interval(secs=>seconds_per_question),deadline_at) where id=a.id;
   perform exam_private.reconcile(a.id);outcome:='accepted';
  end if;
 end if;
 insert into exam_private.commands values(a.id,p_key,p_position,p_option_id,outcome);
 return exam_private.view_attempt(a.id)||jsonb_build_object('outcome',outcome);
end $$;

revoke all on all tables in schema exam_private from public,anon,authenticated;
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.my_profile(),public.student_modules(),public.attempt_start_or_resume(uuid),public.attempt_current(uuid),public.attempt_submit_answer(uuid,int,uuid,uuid) from public,anon;
grant execute on function public.my_profile(),public.student_modules(),public.attempt_start_or_resume(uuid),public.attempt_current(uuid),public.attempt_submit_answer(uuid,int,uuid,uuid) to authenticated;
