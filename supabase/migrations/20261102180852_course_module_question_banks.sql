-- Banks belong to course modules; the old exam link is retained only as provenance.
alter table exam_private.questions add column course_module_id uuid references exam_private.course_modules(id);
update exam_private.questions q set course_module_id=m.course_module_id from exam_private.modules m where m.id=q.module_id;
alter table exam_private.questions alter column course_module_id set not null;
alter table exam_private.questions alter column module_id drop not null;
alter table exam_private.questions drop constraint questions_module_id_fkey;
alter table exam_private.questions add constraint questions_origin_exam_fkey foreign key(module_id) references exam_private.modules(id) on delete set null;
alter table exam_private.questions drop constraint questions_module_id_external_id_key;
-- Identical copies collapse. Divergent versions keep their full content with distinct IDs.
with ranked as (select id,row_number() over(partition by course_module_id,external_id,lecture,difficulty,text,options,correct,active order by id) n from exam_private.questions)
delete from exam_private.questions q using ranked r where q.id=r.id and r.n>1;
with ranked as (select id,row_number() over(partition by course_module_id,external_id order by id) n from exam_private.questions)
update exam_private.questions q set external_id=q.external_id||'~'||q.id::text from ranked r where q.id=r.id and r.n>1;
create unique index questions_course_external_unique on exam_private.questions(course_module_id,external_id);
create or replace function exam_private.validate_module(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare m exam_private.modules; item record; total int:=0; needed int; begin
 select * into strict m from exam_private.modules where id=mid;
 perform 1 from exam_private.course_modules where id=m.course_module_id for share;
 if (select count(*) from exam_private.questions where course_module_id=m.course_module_id and active)<m.question_count then raise exception 'Недостаточно активных вопросов';end if;
 if m.selection_mode='quotas' then
  for item in select key,value from jsonb_each_text(m.quotas) loop
   needed:=item.value::int;if needed<0 or needed>200 then raise exception 'Некорректная квота';end if;
   if (select count(*) from exam_private.questions where course_module_id=m.course_module_id and active and lecture=item.key)<needed then raise exception 'Недостаточно вопросов в теме %',item.key;end if;
   total:=total+needed;
  end loop;
  if total<>m.question_count then raise exception 'Сумма квот должна совпадать с числом вопросов';end if;
 end if;
 if not exists(select 1 from exam_private.module_groups where module_id=mid and access) then raise exception 'Разрешите доступ хотя бы одной группе';end if;
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
 perform 1 from exam_private.course_modules where id=m.course_module_id for share;
 if m.selection_mode='random' then
  select array_agg(id) into selected from (select id from exam_private.questions where course_module_id=m.course_module_id and active order by random() limit m.question_count)x;
 else
  for item in select key,value from jsonb_each_text(m.quotas) loop
   needed:=item.value::int;
   select selected||coalesce(array_agg(id),'{}'::uuid[]) into selected from (select id from exam_private.questions where course_module_id=m.course_module_id and active and lecture=item.key order by random() limit needed)x;
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
create or replace function exam_private.admin_command_base(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); mid uuid; m exam_private.modules; q jsonb; gid text; target text; st text; oldid uuid; begin
 perform exam_private.throttle('admin',120);
 mid:=nullif(p_data->>'module_id','')::uuid;target:=coalesce(mid::text,p_data->>'id');
 if mid is not null then select * into strict m from exam_private.modules where id=mid for update;end if;
 case p_action
 when 'save_module' then
  if mid is not null and m.status<>'draft' then raise exception 'Настройки изменяются только в черновике';end if;
  if mid is null then insert into exam_private.modules(title) values(p_data->>'title') returning id into mid;end if;
  update exam_private.modules set title=p_data->>'title',question_count=(p_data->>'question_count')::int,seconds_per_question=(p_data->>'seconds_per_question')::int,total_seconds=(p_data->>'total_seconds')::int,max_score=(p_data->>'max_score')::numeric,selection_mode=p_data->>'selection_mode',quotas=coalesce(p_data->'quotas','{}') where id=mid;
 when 'copy_module' then
  oldid:=mid;
  insert into exam_private.modules(title,question_count,seconds_per_question,total_seconds,max_score,selection_mode,quotas)
  select title||' — копия',question_count,seconds_per_question,total_seconds,max_score,selection_mode,quotas from exam_private.modules where id=oldid returning id into mid;
  insert into exam_private.module_groups(module_id,group_id) select mid,group_id from exam_private.module_groups where module_id=oldid;
 when 'transition' then
  st:=p_data->>'status';
  if not ((m.status='draft' and st='open') or (m.status='open' and st='closed') or (m.status='closed' and st in ('open','published','archived')) or (m.status='published' and st='archived')) then raise exception 'Недопустимый переход статуса';end if;
  if st='open' then perform exam_private.validate_module(mid);end if;
  if st in ('published','archived') then
   perform exam_private.reconcile(id) from exam_private.attempts where module_id=mid and status='active';
   if exists(select 1 from exam_private.attempts where module_id=mid and status='active') then raise exception 'Есть незавершённые попытки';end if;
  end if;
  update exam_private.modules set status=st,published_at=case when st='published' then clock_timestamp() else published_at end where id=mid;
 when 'save_group' then
  insert into exam_private.groups values(p_data->>'id',p_data->>'name') on conflict(id) do update set name=excluded.name;
 when 'delete_group' then
  delete from exam_private.module_groups where group_id=p_data->>'id';delete from exam_private.groups where id=p_data->>'id';
 when 'group_access' then
  if m.status in ('published','archived') then raise exception 'Модуль уже завершён';end if;
  insert into exam_private.module_groups values(mid,p_data->>'group_id',(p_data->>'access')::boolean,nullif(p_data->>'window_start','')::timestamptz,nullif(p_data->>'window_end','')::timestamptz)
  on conflict(module_id,group_id) do update set access=excluded.access,window_start=excluded.window_start,window_end=excluded.window_end;
 when 'student_status' then update exam_private.profiles set active=(p_data->>'active')::boolean where id=(select auth_id from exam_private.students where id=p_data->>'id');
 when 'rename_student' then
  update exam_private.students set group_id=p_data->>'group_id' where id=p_data->>'id';
  update exam_private.profiles set full_name=p_data->>'full_name' where id=(select auth_id from exam_private.students where id=p_data->>'id');
 when 'save_questions','delete_question' then raise exception 'Используйте банк учебного модуля';
 else raise exception 'Неизвестная команда';
 end case;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,coalesce(mid::text,target),p_data-'questions');
 return jsonb_build_object('ok',true,'module_id',mid);
end $$;
create function public.admin_course_questions(p_course_module_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform exam_private.teacher();return coalesce((select jsonb_agg(to_jsonb(q)-'module_id' order by external_id) from exam_private.questions q where course_module_id=p_course_module_id),'[]');end $$;
create or replace function public.admin_questions(p_module_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;begin perform exam_private.teacher();select course_module_id into strict cid from exam_private.modules where id=p_module_id;return public.admin_course_questions(cid);end $$;
create function public.admin_bank_command(p_action text,p_course_module_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher();q jsonb;begin
 perform exam_private.throttle('admin',120);
 perform 1 from exam_private.course_modules where id=p_course_module_id for update;
 if not found then raise exception 'Учебный модуль не найден';end if;
 if p_action='save_questions' then
  if jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Импортируйте от 1 до 500 вопросов';end if;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
   if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options')<>4 or exists(select 1 from jsonb_array_elements_text(q->'options') v where length(trim(v))=0) or (select count(distinct v) from jsonb_array_elements_text(q->'options') v)<>4 or coalesce(length(q->>'lecture'),0)=0 or coalesce(length(trim(q->>'external_id')),0)=0 then raise exception 'Нужны QuestionID, тема и четыре разных непустых варианта';end if;
   insert into exam_private.questions(course_module_id,external_id,lecture,difficulty,text,options,correct,active)
   values(p_course_module_id,q->>'external_id',q->>'lecture',coalesce(q->>'difficulty','normal'),q->>'text',q->'options',(q->>'correct')::int,coalesce((q->>'active')::boolean,true))
   on conflict(course_module_id,external_id) do update set lecture=excluded.lecture,difficulty=excluded.difficulty,text=excluded.text,options=excluded.options,correct=excluded.correct,active=excluded.active,version=exam_private.questions.version+1;
  end loop;
 elsif p_action='delete_question' then
  delete from exam_private.questions where id=(p_data->>'id')::uuid and course_module_id=p_course_module_id;
  if not found then raise exception 'Вопрос не найден в выбранном модуле';end if;
 else raise exception 'Неизвестная команда банка';end if;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,p_course_module_id::text,p_data-'questions');
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.admin_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); result jsonb; cid uuid; sid uuid; existing_id uuid; mid uuid; begin
 if p_action in ('save_questions','delete_question') then
  select course_module_id into strict cid from exam_private.modules where id=(p_data->>'module_id')::uuid;
  return public.admin_bank_command(p_action,cid,p_data);
 end if;
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
create or replace function public.admin_delete_unused_exam(p_module_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); m exam_private.modules;
begin
 select * into m from exam_private.modules where id=p_module_id for update;
 if not found then raise exception 'Экзамен не найден';end if;
 if p_confirmation is distinct from m.title then raise exception 'Введите точное название экзамена';end if;
 if m.status<>'draft' then raise exception 'Удалить можно только неиспользованный черновик';end if;
 if exists(select 1 from exam_private.attempts where module_id=m.id) or exists(select 1 from exam_private.attempt_slots where module_id=m.id) or exists(select 1 from exam_private.retake_grants where module_id=m.id) then raise exception 'У экзамена есть история попыток. Удаление запрещено';end if;
 delete from exam_private.module_groups where module_id=m.id;

 delete from exam_private.modules where id=m.id;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,'unused_exam_deleted',m.id::text,jsonb_build_object('title',m.title,'status',m.status));
 return jsonb_build_object('deleted',true);
end $$;
-- Full catalog remains private for the history endpoint.
alter function public.student_modules() set schema exam_private;
alter function exam_private.student_modules() rename to student_exam_catalog;
create function public.student_modules() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(item),'[]') from jsonb_array_elements(exam_private.student_exam_catalog()) item
 where item->>'status'<>'archived' and ((item->>'status'='open' and item->>'attempt_status' is null) or item->>'attempt_status'='active' or (item->>'retake_allowed')::boolean);
$$;
create function public.student_exam_history() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(item),'[]') from jsonb_array_elements(exam_private.student_exam_catalog()) item
 where item->>'attempt_status'='finished';
$$;
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.student_modules(),public.admin_course_questions(uuid),public.admin_bank_command(text,uuid,jsonb),public.student_exam_history() from public,anon;
grant execute on function public.admin_course_questions(uuid),public.admin_bank_command(text,uuid,jsonb),public.student_exam_history() to authenticated;
notify pgrst,'reload schema';
