alter table exam_private.profiles drop constraint profiles_role_check;
alter table exam_private.profiles add constraint profiles_role_check check(role in ('student','teacher','superadmin'));
create or replace function exam_private.teacher() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor(); begin
 if not exists(select 1 from exam_private.profiles where id=u and role in ('teacher','superadmin')) then raise exception 'Требуются права преподавателя' using errcode='42501';end if;return u;
end $$;
create function exam_private.superadmin() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor();begin
 if not exists(select 1 from exam_private.profiles where id=u and role='superadmin') then raise exception 'Требуются права суперадмина' using errcode='42501';end if;return u;
end $$;

-- Completion and validity are separate: invalidated attempts retain their progress and answers.
alter table exam_private.attempts add column is_current boolean not null default true;
alter table exam_private.attempts add column attempt_number int not null default 1 check(attempt_number>0);
alter table exam_private.attempts add column voided_at timestamptz;
alter table exam_private.attempts add column voided_by uuid;
alter table exam_private.attempts add column voided_by_name text;
alter table exam_private.attempts add column void_reason text;
alter table exam_private.attempts add column voided_from_status text;
alter table exam_private.attempts drop constraint attempts_module_id_student_id_key;
create unique index attempts_one_current on exam_private.attempts(module_id,student_id) where is_current;
create unique index attempts_number_unique on exam_private.attempts(module_id,student_id,attempt_number);
create table exam_private.attempt_slots(
 module_id uuid references exam_private.modules(id),student_id text references exam_private.students(id),
 started_count int not null default 0 check(started_count>=0),last_number int not null default 0 check(last_number>=0),primary key(module_id,student_id)
);
insert into exam_private.attempt_slots select module_id,student_id,count(*)::int,max(attempt_number) from exam_private.attempts group by module_id,student_id;
create table exam_private.retake_grants(
 id uuid primary key default gen_random_uuid(),module_id uuid not null references exam_private.modules(id),student_id text not null references exam_private.students(id),
 actor uuid not null,actor_name text not null,reason text not null check(length(trim(reason)) between 3 and 1000),
 granted_at timestamptz not null default clock_timestamp(),start_deadline timestamptz not null,
 consumed_at timestamptz,revoked_at timestamptz,attempt_id uuid references exam_private.attempts(id) on delete set null,
 previous_attempt_id uuid
);
create unique index retake_grants_one_pending on exam_private.retake_grants(module_id,student_id) where consumed_at is null and revoked_at is null;
create index retake_grants_student_idx on exam_private.retake_grants(student_id,module_id);
alter table exam_private.attempts add column retake_grant_id uuid references exam_private.retake_grants(id);
create table exam_private.admin_requests(actor uuid,key uuid,payload jsonb not null,response jsonb not null,primary key(actor,key));
alter table exam_private.results add column published_at timestamptz;
update exam_private.results r set published_at=m.published_at from exam_private.attempts a join exam_private.modules m on m.id=a.module_id where a.id=r.attempt_id;
alter table exam_private.attempt_slots enable row level security;
alter table exam_private.retake_grants enable row level security;
alter table exam_private.admin_requests enable row level security;
revoke all on exam_private.attempt_slots,exam_private.retake_grants,exam_private.admin_requests from public,anon,authenticated;

create function exam_private.module_publication_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('published','archived') and new.status<>old.status and exists(select 1 from exam_private.retake_grants where module_id=new.id and consumed_at is null and revoked_at is null and start_deadline>clock_timestamp()) then
  raise exception 'Есть неиспользованные разрешения на пересдачу. Дождитесь их использования или отзовите разрешения.';
 end if;return new;
end $$;
create trigger module_publication_guard before update of status on exam_private.modules for each row execute function exam_private.module_publication_guard();
create function exam_private.publish_initial_results() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.published_at is null and new.published_at is not null then
  update exam_private.results r set published_at=new.published_at from exam_private.attempts a where a.id=r.attempt_id and a.module_id=new.id and a.is_current and a.status='finished';
 end if;return new;
end $$;
create trigger publish_initial_results after update of published_at on exam_private.modules for each row execute function exam_private.publish_initial_results();

create or replace function exam_private.view_attempt_base(aid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a exam_private.attempts;q exam_private.attempt_questions;m exam_private.modules;r exam_private.results;base jsonb;begin
 select * into strict a from exam_private.attempts where id=aid;select * into strict m from exam_private.modules where id=a.module_id;
 base:=jsonb_build_object('attempt_id',aid,'title',m.title,'total',a.question_count,'server_now',clock_timestamp(),'attempt_deadline',a.deadline_at,'attempt_number',a.attempt_number);
 if not a.is_current then return base||jsonb_build_object('done',true,'published',false,'annulled',true,'void_reason',a.void_reason);end if;
 if a.status='finished' then
  select * into r from exam_private.results where attempt_id=aid;
  return base||jsonb_build_object('done',true,'published',r.published_at is not null)||case when r.published_at is not null then jsonb_build_object('score',r.score,'correct',r.correct_count,'max_score',a.max_score) else '{}'::jsonb end;
 end if;
 select * into strict q from exam_private.attempt_questions where attempt_id=aid and position=a.current_index;
 return base||jsonb_build_object('done',false,'index',a.current_index+1,'question',q.text,'options',q.options,'question_deadline',a.question_deadline);
end $$;

create or replace function public.student_modules() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor();begin
 return coalesce((select jsonb_agg(to_jsonb(m)||exam_private.catalog_label(m.id)||jsonb_build_object(
 'available',a.id is null and m.status not in ('draft','archived') and ((coalesce(sl.started_count,0)=0 and m.status='open' and mg.access and (mg.window_start is null or clock_timestamp()>=mg.window_start) and (mg.window_end is null or clock_timestamp()<mg.window_end)) or g.id is not null),
 'attempt_id',a.id,'attempt_status',a.status,'attempt_number',a.attempt_number,'attempt_count',coalesce(sl.started_count,0),'retake_allowed',g.id is not null,'retake_deadline',g.start_deadline,'retake_reason',g.reason,
 'needs_retake',a.id is null and coalesce(sl.started_count,0)>0 and g.id is null) order by m.created_at desc)
 from exam_private.students s cross join exam_private.modules m
 left join exam_private.module_groups mg on mg.module_id=m.id and mg.group_id=s.group_id
 left join exam_private.attempts a on a.module_id=m.id and a.student_id=s.id and a.is_current
 left join exam_private.attempt_slots sl on sl.module_id=m.id and sl.student_id=s.id
 left join exam_private.retake_grants g on g.module_id=m.id and g.student_id=s.id and g.consumed_at is null and g.revoked_at is null and g.start_deadline>clock_timestamp()
 where s.auth_id=u and m.status<>'draft' and (mg.module_id is not null or sl.module_id is not null or g.id is not null)),'[]');
end $$;

create or replace function public.attempt_start_or_resume(p_module_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=exam_private.actor();s exam_private.students;m exam_private.modules;a exam_private.attempts;sl exam_private.attempt_slots;g exam_private.retake_grants;
 q exam_private.questions;selected uuid[]:='{}';item record;needed int;pos int:=0;opts jsonb;cid uuid;oid uuid;i int;t timestamptz;
begin
 perform exam_private.throttle('start',30);select * into strict s from exam_private.students where auth_id=u;
 select * into strict m from exam_private.modules where id=p_module_id for share;
 perform 1 from exam_private.students where id=s.id for update;
 select * into a from exam_private.attempts where student_id=s.id and module_id=m.id and is_current for update;
 if found then perform exam_private.reconcile(a.id);return exam_private.view_attempt(a.id);end if;
 insert into exam_private.attempt_slots(module_id,student_id) values(m.id,s.id) on conflict do nothing;
 select * into strict sl from exam_private.attempt_slots where module_id=m.id and student_id=s.id for update;
 select * into g from exam_private.retake_grants where module_id=m.id and student_id=s.id and consumed_at is null and revoked_at is null and start_deadline>clock_timestamp() for update;
 if m.status in ('draft','archived') then raise exception 'Экзамен недоступен для нового запуска';end if;
 if sl.started_count>0 then
  if g.id is null then raise exception 'Для новой попытки требуется разрешение преподавателя';end if;
 elsif m.status<>'open' or not exists(select 1 from exam_private.module_groups mg where mg.module_id=m.id and mg.group_id=s.group_id and mg.access and (mg.window_start is null or clock_timestamp()>=mg.window_start) and (mg.window_end is null or clock_timestamp()<mg.window_end)) then raise exception 'Приём для вашей группы закрыт';end if;
 if m.selection_mode='random' then
  select array_agg(id) into selected from (select id from exam_private.questions where module_id=m.id and active order by random() limit m.question_count)x;
 else
  for item in select key,value from jsonb_each_text(m.quotas) loop
   needed:=item.value::int;
   select selected||coalesce(array_agg(id),'{}'::uuid[]) into selected from (select id from exam_private.questions where module_id=m.id and active and lecture=item.key order by random() limit needed)x;
  end loop;
 end if;
 if coalesce(array_length(selected,1),0)<>m.question_count then raise exception 'Недостаточно вопросов в банке';end if;
 t:=clock_timestamp();
 insert into exam_private.attempts(module_id,student_id,group_id,question_count,seconds_per_question,max_score,started_at,deadline_at,question_deadline,attempt_number,retake_grant_id)
 values(m.id,s.id,s.group_id,m.question_count,m.seconds_per_question,m.max_score,t,t+make_interval(secs=>m.total_seconds),least(t+make_interval(secs=>m.seconds_per_question),t+make_interval(secs=>m.total_seconds)),sl.last_number+1,g.id) returning * into a;
 for q in select * from exam_private.questions where id=any(selected) order by random() loop
  opts:='[]';cid:=null;
  for i in 0..3 loop oid:=gen_random_uuid();if i=q.correct then cid:=oid;end if;opts:=opts||jsonb_build_array(jsonb_build_object('id',oid,'text',q.options->>i));end loop;
  select jsonb_agg(value order by random()) into opts from jsonb_array_elements(opts);
  insert into exam_private.attempt_questions values(a.id,pos,q.id,q.version,q.text,opts,cid);pos:=pos+1;
 end loop;
 update exam_private.attempt_slots set started_count=started_count+1,last_number=last_number+1 where module_id=m.id and student_id=s.id;
 if g.id is not null then update exam_private.retake_grants set consumed_at=t,attempt_id=a.id where id=g.id;end if;
 return exam_private.view_attempt(a.id);
end $$;

-- All operations that mutate an attempt acquire its module first, matching reset/delete.
-- This also avoids FK KEY SHARE / module UPDATE deadlocks during an answer.
alter function public.attempt_submit_answer(uuid,int,uuid,uuid) set schema exam_private;
alter function exam_private.attempt_submit_answer(uuid,int,uuid,uuid) rename to attempt_submit_answer_base;
create function public.attempt_submit_answer(p_attempt_id uuid,p_position int,p_option_id uuid,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform exam_private.own_attempt(p_attempt_id);
 perform 1 from exam_private.modules where id=(select module_id from exam_private.attempts where id=p_attempt_id) for share;
 perform exam_private.own_attempt(p_attempt_id);
 return exam_private.attempt_submit_answer_base(p_attempt_id,p_position,p_option_id,p_key);
end $$;
create or replace function public.attempt_current(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform exam_private.own_attempt(p_attempt_id);
 perform 1 from exam_private.modules where id=(select module_id from exam_private.attempts where id=p_attempt_id) for share;
 perform exam_private.own_attempt(p_attempt_id);
 perform exam_private.throttle('current',90);perform exam_private.reconcile(p_attempt_id);return exam_private.view_attempt(p_attempt_id);
end $$;

create function public.admin_attempt_action(p_action text,p_module_id uuid,p_student_id text,p_reason text,p_key uuid,p_attempt_id uuid default null,p_start_deadline timestamptz default null,p_confirmation text default null,p_grant_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher();actor_name text;is_super boolean;m exam_private.modules;s exam_private.students;a exam_private.attempts;sl exam_private.attempt_slots;
 payload jsonb;cached exam_private.admin_requests;reason text:=trim(p_reason);gid uuid;deadline timestamptz;result jsonb;
begin
 if p_action not in ('grant_retake','revoke_retake','delete_attempt','publish_result') then raise exception 'Неизвестная операция';end if;
 select p.role='superadmin',p.full_name into is_super,actor_name from exam_private.profiles p where id=actor;
 if p_action in ('delete_attempt','publish_result') then perform exam_private.superadmin();end if;
 if coalesce(length(reason),0) not between 3 and 1000 or p_key is null then raise exception 'Укажите причину: от 3 до 1000 символов';end if;
 perform exam_private.throttle('attempt_admin',60);
 select * into strict m from exam_private.modules where id=p_module_id for update;
 select * into strict s from exam_private.students where id=p_student_id for update;
 if m.published_at is not null and not is_super then raise exception 'После публикации требуется суперадмин' using errcode='42501';end if;
 payload:=jsonb_build_object('action',p_action,'module_id',p_module_id,'student_id',p_student_id,'reason',reason,'attempt_id',p_attempt_id,'deadline',p_start_deadline,'confirmation',p_confirmation,'grant_id',p_grant_id);
 select * into cached from exam_private.admin_requests ar where ar.actor=auth.uid() and ar.key=p_key;
 if found then if cached.payload<>payload then raise exception 'Ключ запроса уже использован с другими параметрами';end if;return cached.response;end if;
 if p_action='grant_retake' then
  if m.status in ('draft','archived') then raise exception 'Пересдача доступна для открытого, закрытого или опубликованного экзамена';end if;
  select * into sl from exam_private.attempt_slots where module_id=m.id and student_id=s.id for update;
  if not found or sl.started_count=0 then raise exception 'Студент ещё не начинал этот экзамен';end if;
  deadline:=coalesce(p_start_deadline,clock_timestamp()+interval '24 hours');if deadline<=clock_timestamp() then raise exception 'Срок начала пересдачи должен быть в будущем';end if;
  select * into a from exam_private.attempts where module_id=m.id and student_id=s.id and is_current for update;
  if p_attempt_id is not null and a.id is distinct from p_attempt_id then raise exception 'Попытка уже изменилась. Обновите страницу.';end if;
  if a.id is not null then
   update exam_private.attempts set is_current=false,voided_at=clock_timestamp(),voided_by=actor,voided_by_name=actor_name,void_reason=reason,voided_from_status=status,status='finished',finished_at=coalesce(finished_at,clock_timestamp()) where id=a.id;
  end if;
  update exam_private.retake_grants set revoked_at=clock_timestamp() where module_id=m.id and student_id=s.id and consumed_at is null and revoked_at is null;
  insert into exam_private.retake_grants(module_id,student_id,actor,actor_name,reason,start_deadline,previous_attempt_id) values(m.id,s.id,actor,actor_name,reason,deadline,a.id) returning id into gid;
  result:=jsonb_build_object('ok',true,'grant_id',gid);
 elsif p_action='revoke_retake' then
  update exam_private.retake_grants set revoked_at=clock_timestamp() where id=p_grant_id and module_id=m.id and student_id=s.id and consumed_at is null and revoked_at is null returning id into gid;
  if not found then raise exception 'Разрешение уже использовано или отозвано';end if;
  result:=jsonb_build_object('ok',true,'grant_id',gid);
 else
  select * into strict a from exam_private.attempts where id=p_attempt_id and module_id=m.id and student_id=s.id for update;
  if p_action='publish_result' then
   if m.published_at is null or not a.is_current or a.status<>'finished' then raise exception 'Можно опубликовать только завершённую действующую пересдачу опубликованного экзамена';end if;
   update exam_private.results set published_at=clock_timestamp() where attempt_id=a.id and published_at is null;
   if not found then raise exception 'Результат отсутствует или уже опубликован';end if;
  else
   if p_confirmation is distinct from s.login then raise exception 'Введите логин студента для подтверждения удаления';end if;
   delete from exam_private.answers where attempt_id=a.id;
   delete from exam_private.commands where attempt_id=a.id;
   delete from exam_private.results where attempt_id=a.id;
   delete from exam_private.attempt_questions where attempt_id=a.id;
   delete from exam_private.attempts where id=a.id;
  end if;
  result:=jsonb_build_object('ok',true,'attempt_id',a.id);
 end if;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,coalesce(a.id::text,gid::text),jsonb_build_object('module_id',m.id,'student_id',s.id,'reason',reason,'actor_name',actor_name,'grant_id',gid));
 insert into exam_private.admin_requests values(actor,p_key,payload,result);
 return result;
end $$;

create or replace function public.admin_data(p_module_id uuid default null,p_group_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher();result jsonb;begin
 perform 1 from exam_private.modules where p_module_id is null or id=p_module_id order by id for share;
 perform exam_private.reconcile(id) from exam_private.attempts where is_current and status='active' and question_deadline<=clock_timestamp() and (p_module_id is null or module_id=p_module_id);
 select jsonb_build_object(
 'actor_role',(select role from exam_private.profiles where id=actor),
 'modules',(select coalesce(jsonb_agg(to_jsonb(m)||exam_private.catalog_label(m.id) order by created_at desc),'[]') from exam_private.modules m),
 'subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from exam_private.subjects s),
 'course_modules',(select coalesce(jsonb_agg(to_jsonb(c) order by position,title),'[]') from exam_private.course_modules c),
 'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by name),'[]') from exam_private.groups g),
 'students',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('full_name',p.full_name,'active',p.active) order by p.full_name),'[]') from exam_private.students s join exam_private.profiles p on p.id=s.auth_id),
 'module_groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from exam_private.module_groups g),
 'attempt_counters',(select coalesce(jsonb_agg(to_jsonb(sl)),'[]') from exam_private.attempt_slots sl),
 'retake_grants',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('full_name',p.full_name,'login',s.login,'group_id',s.group_id) order by granted_at desc),'[]') from exam_private.retake_grants g join exam_private.students s on s.id=g.student_id join exam_private.profiles p on p.id=s.auth_id where (p_module_id is null or g.module_id=p_module_id) and (p_group_id is null or s.group_id=p_group_id)),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('status',case when a.is_current then a.status else 'annulled' end,'full_name',p.full_name,'login',s.login,'correct_count',r.correct_count,'score',r.score,'result_published_at',r.published_at) order by a.started_at desc),'[]') from exam_private.attempts a join exam_private.students s on s.id=a.student_id join exam_private.profiles p on p.id=s.auth_id left join exam_private.results r on r.attempt_id=a.id where (p_module_id is null or a.module_id=p_module_id) and (p_group_id is null or a.group_id=p_group_id)),
 'stats',jsonb_build_object('students',(select count(*) from exam_private.students where p_group_id is null or group_id=p_group_id),'groups',(select count(*) from exam_private.groups),'started',count(*),'active',count(*) filter(where a.status='active'),'finished',count(*) filter(where a.status='finished'),'average',round(avg(r.score),2))) into result
 from exam_private.attempts a left join exam_private.results r on r.attempt_id=a.id where a.is_current and (p_module_id is null or a.module_id=p_module_id) and (p_group_id is null or a.group_id=p_group_id);
 return result;
end $$;
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.admin_attempt_action(text,uuid,text,text,uuid,uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.admin_attempt_action(text,uuid,text,text,uuid,uuid,timestamptz,text,uuid) to authenticated;
revoke all on function public.attempt_submit_answer(uuid,int,uuid,uuid) from public,anon;
grant execute on function public.attempt_submit_answer(uuid,int,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
