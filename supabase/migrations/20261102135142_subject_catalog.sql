-- The existing `modules` records remain exams; their IDs and all attempts stay intact.
create table exam_private.subjects (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120)
);
create unique index subjects_name_unique on exam_private.subjects(lower(trim(name)));
create table exam_private.course_modules (
 id uuid primary key default gen_random_uuid(),
 subject_id uuid not null references exam_private.subjects(id),
 title text not null check(length(trim(title)) between 1 and 120),
 position int not null default 1 check(position between 1 and 1000)
);
create index course_modules_subject_idx on exam_private.course_modules(subject_id);
create unique index course_modules_title_unique on exam_private.course_modules(subject_id,lower(trim(title)));
alter table exam_private.subjects enable row level security;
alter table exam_private.course_modules enable row level security;
revoke all on exam_private.subjects,exam_private.course_modules from public,anon,authenticated;

insert into exam_private.subjects(name) values('Web-разработка'),('UX/UI');
insert into exam_private.course_modules(subject_id,title,position)
 select s.id,'Модуль '||n,n from exam_private.subjects s cross join generate_series(1,2) n;
alter table exam_private.modules add column course_module_id uuid references exam_private.course_modules(id);
do $$ declare default_id uuid; begin
 select c.id into strict default_id from exam_private.course_modules c join exam_private.subjects s on s.id=c.subject_id where s.name='Web-разработка' and c.position=1;
 update exam_private.modules set course_module_id=default_id;
 -- Keep older clients working during rollout. New UI requires an explicit selection.
 execute format('alter table exam_private.modules alter column course_module_id set default %L::uuid',default_id);
end $$;
alter table exam_private.modules alter column course_module_id set not null;
create index modules_course_module_idx on exam_private.modules(course_module_id);

create function exam_private.catalog_label(mid uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('course_module_id',c.id,'course_module_title',c.title,'subject_id',s.id,'subject_name',s.name)
 from exam_private.modules m join exam_private.course_modules c on c.id=m.course_module_id join exam_private.subjects s on s.id=c.subject_id where m.id=mid;
$$;

alter function public.admin_data(uuid,text) set schema exam_private;
alter function exam_private.admin_data(uuid,text) rename to admin_data_base;
create function public.admin_data(p_module_id uuid default null,p_group_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 result:=exam_private.admin_data_base(p_module_id,p_group_id);
 return result||jsonb_build_object(
 'modules',(select coalesce(jsonb_agg(item||exam_private.catalog_label((item->>'id')::uuid)),'[]') from jsonb_array_elements(result->'modules') item),
 'subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from exam_private.subjects s),
 'course_modules',(select coalesce(jsonb_agg(to_jsonb(c) order by position,title),'[]') from exam_private.course_modules c));
end $$;

alter function public.student_modules() set schema exam_private;
alter function exam_private.student_modules() rename to student_modules_base;
create function public.student_modules() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 result:=exam_private.student_modules_base();
 return coalesce((select jsonb_agg(item||exam_private.catalog_label((item->>'id')::uuid)) from jsonb_array_elements(result)item),'[]');
end $$;

alter function exam_private.view_attempt(uuid) rename to view_attempt_base;
create function exam_private.view_attempt(aid uuid) returns jsonb language sql security definer set search_path='' as $$
 select exam_private.view_attempt_base(aid)||exam_private.catalog_label(a.module_id) from exam_private.attempts a where a.id=aid;
$$;

alter function public.admin_command(text,jsonb) set schema exam_private;
alter function exam_private.admin_command(text,jsonb) rename to admin_command_base;
create function public.admin_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); result jsonb; cid uuid; sid uuid; existing_id uuid; mid uuid; begin
 if p_action='save_subject' then
  perform exam_private.throttle('admin',120);
  sid:=nullif(p_data->>'id','')::uuid;
  if sid is null then insert into exam_private.subjects(name) values(trim(p_data->>'name')) returning id into sid;
  else update exam_private.subjects set name=trim(p_data->>'name') where id=sid;if not found then raise exception 'Дисциплина не найдена';end if;end if;
  result:=jsonb_build_object('ok',true,'subject_id',sid);
 elsif p_action='save_course_module' then
  perform exam_private.throttle('admin',120);
  cid:=nullif(p_data->>'id','')::uuid;sid:=(p_data->>'subject_id')::uuid;
  if cid is null then insert into exam_private.course_modules(subject_id,title,position) values(sid,trim(p_data->>'title'),coalesce((p_data->>'position')::int,1)) returning id into cid;
  else
   select subject_id into strict existing_id from exam_private.course_modules where id=cid for update;
   if existing_id<>sid then raise exception 'Модуль нельзя переносить в другую дисциплину. Создайте новый.';end if;
   update exam_private.course_modules set title=trim(p_data->>'title'),position=coalesce((p_data->>'position')::int,position) where id=cid;
  end if;
  result:=jsonb_build_object('ok',true,'course_module_id',cid);
 else
  cid:=nullif(p_data->>'course_module_id','')::uuid;
  if cid is not null then perform 1 from exam_private.course_modules where id=cid for share;if not found then raise exception 'Учебный модуль не найден';end if;end if;
  result:=exam_private.admin_command_base(p_action,p_data);
  if p_action='copy_module' then
   select coalesce(cid,course_module_id) into cid from exam_private.modules where id=(p_data->>'module_id')::uuid;
  end if;
  if p_action in ('save_module','copy_module') and cid is not null then
   update exam_private.modules set course_module_id=cid where id=(result->>'module_id')::uuid;
  end if;
  return result;
 end if;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,coalesce(sid,cid)::text,p_data);
 return result;
end $$;

revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.admin_data(uuid,text),public.admin_command(text,jsonb),public.student_modules() from public,anon;
grant execute on function public.admin_data(uuid,text),public.admin_command(text,jsonb),public.student_modules() to authenticated;
notify pgrst,'reload schema';
