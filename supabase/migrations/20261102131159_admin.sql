create function public.admin_data(p_module_id uuid default null,p_group_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform exam_private.teacher();
 -- Catch up expired attempts before showing statistics or publishing.
 perform exam_private.reconcile(id) from exam_private.attempts where status='active' and question_deadline<=clock_timestamp() and (p_module_id is null or module_id=p_module_id);
 select jsonb_build_object(
 'modules',(select coalesce(jsonb_agg(to_jsonb(m) order by created_at desc),'[]') from exam_private.modules m),
 'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by name),'[]') from exam_private.groups g),
 'students',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('full_name',p.full_name,'active',p.active) order by p.full_name),'[]') from exam_private.students s join exam_private.profiles p on p.id=s.auth_id),
 'module_groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from exam_private.module_groups g),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('full_name',p.full_name,'correct_count',r.correct_count,'score',r.score) order by a.started_at desc),'[]') from exam_private.attempts a join exam_private.students s on s.id=a.student_id join exam_private.profiles p on p.id=s.auth_id left join exam_private.results r on r.attempt_id=a.id where (p_module_id is null or a.module_id=p_module_id) and (p_group_id is null or a.group_id=p_group_id)),
 'stats',jsonb_build_object('students',(select count(*) from exam_private.students where p_group_id is null or group_id=p_group_id),'groups',(select count(*) from exam_private.groups),
 'started',count(*),'active',count(*) filter(where a.status='active'),'finished',count(*) filter(where a.status='finished'),'average',round(avg(r.score),2))) into result
 from exam_private.attempts a left join exam_private.results r on r.attempt_id=a.id where (p_module_id is null or a.module_id=p_module_id) and (p_group_id is null or a.group_id=p_group_id);
 return result;
end $$;
create function public.admin_questions(p_module_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform exam_private.teacher();return coalesce((select jsonb_agg(to_jsonb(q) order by external_id) from exam_private.questions q where module_id=p_module_id),'[]');end $$;

create function exam_private.validate_module(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare m exam_private.modules; item record; total int:=0; needed int; begin
 select * into strict m from exam_private.modules where id=mid;
 if (select count(*) from exam_private.questions where module_id=mid and active)<m.question_count then raise exception 'Недостаточно активных вопросов';end if;
 if m.selection_mode='quotas' then
  for item in select key,value from jsonb_each_text(m.quotas) loop
   needed:=item.value::int;if needed<0 or needed>200 then raise exception 'Некорректная квота';end if;
   if (select count(*) from exam_private.questions where module_id=mid and active and lecture=item.key)<needed then raise exception 'Недостаточно вопросов в теме %',item.key;end if;
   total:=total+needed;
  end loop;
  if total<>m.question_count then raise exception 'Сумма квот должна совпадать с числом вопросов';end if;
 end if;
 if not exists(select 1 from exam_private.module_groups where module_id=mid and access) then raise exception 'Разрешите доступ хотя бы одной группе';end if;
end $$;

create function public.admin_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  insert into exam_private.questions(module_id,external_id,lecture,difficulty,text,options,correct,active,version) select mid,external_id,lecture,difficulty,text,options,correct,active,version from exam_private.questions where module_id=oldid;
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
 when 'save_questions' then
  if m.status<>'draft' then raise exception 'Вопросы изменяются только в черновике. Скопируйте модуль.';end if;
  if jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Импортируйте от 1 до 500 вопросов';end if;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
   if jsonb_array_length(q->'options')<>4 or exists(select 1 from jsonb_array_elements_text(q->'options') v where length(trim(v))=0) or (select count(distinct v) from jsonb_array_elements_text(q->'options') v)<>4 or coalesce(length(q->>'lecture'),0)=0 then raise exception 'Нужны тема и четыре разных непустых варианта';end if;
   insert into exam_private.questions(module_id,external_id,lecture,difficulty,text,options,correct,active)
   values(mid,q->>'external_id',q->>'lecture',coalesce(q->>'difficulty','normal'),q->>'text',q->'options',(q->>'correct')::int,coalesce((q->>'active')::boolean,true))
   on conflict(module_id,external_id) do update set lecture=excluded.lecture,difficulty=excluded.difficulty,text=excluded.text,options=excluded.options,correct=excluded.correct,active=excluded.active,version=exam_private.questions.version+1;
  end loop;
 when 'delete_question' then
  if m.status<>'draft' then raise exception 'Удаление доступно только в черновике';end if;
  delete from exam_private.questions where id=(p_data->>'id')::uuid and module_id=mid;
 else raise exception 'Неизвестная команда';
 end case;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,coalesce(mid::text,target),p_data-'questions');
 return jsonb_build_object('ok',true,'module_id',mid);
end $$;

-- Service-only functions used by the authenticated Edge Function. Never grant these to browsers.
create function public.service_register_student(p_auth_id uuid,p_id text,p_login text,p_name text,p_group text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into exam_private.profiles values(p_auth_id,'student',p_name,true);
 insert into exam_private.students values(p_id,p_auth_id,p_login,p_group);
 insert into exam_private.audit_logs(actor,action,target) values(null,'account_created',p_id);
end $$;
create function public.service_account_audit(p_actor uuid,p_target text,p_action text) returns void language sql security definer set search_path='' as $$
 insert into exam_private.audit_logs(actor,action,target) values(p_actor,p_action,p_target);
$$;
create function public.service_teacher(p_auth_id uuid,p_name text) returns void language sql security definer set search_path='' as $$
 insert into exam_private.profiles values(p_auth_id,'teacher',p_name,true);
$$;
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.admin_data(uuid,text),public.admin_questions(uuid),public.admin_command(text,jsonb) from public,anon;
grant execute on function public.admin_data(uuid,text),public.admin_questions(uuid),public.admin_command(text,jsonb) to authenticated;
revoke all on function public.service_register_student(uuid,text,text,text,text),public.service_teacher(uuid,text),public.service_account_audit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_register_student(uuid,text,text,text,text),public.service_teacher(uuid,text),public.service_account_audit(uuid,text,text) to service_role;
