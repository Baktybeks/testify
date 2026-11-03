create or replace function public.admin_bank_command(p_action text,p_course_module_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher();q jsonb;begin
 perform exam_private.throttle('admin',120);
 perform 1 from exam_private.course_modules where id=p_course_module_id for update;
 if not found then raise exception 'Учебный модуль не найден';end if;
 if p_action='save_questions' then
  if jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Импортируйте от 1 до 500 вопросов';end if;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
   if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options')<>4 or exists(select 1 from jsonb_array_elements_text(q->'options') v where length(trim(v))=0) or (select count(distinct v) from jsonb_array_elements_text(q->'options') v)<>4 or coalesce(length(q->>'lecture'),0)=0 then raise exception 'Нужны тема и четыре разных непустых варианта';end if;
   insert into exam_private.questions(course_module_id,external_id,lecture,difficulty,text,options,correct,active)
   values(p_course_module_id,coalesce(nullif(trim(q->>'external_id'),''),'Q-'||gen_random_uuid()::text),q->>'lecture',coalesce(q->>'difficulty','normal'),q->>'text',q->'options',(q->>'correct')::int,coalesce((q->>'active')::boolean,true))
   on conflict(course_module_id,external_id) do update set lecture=excluded.lecture,difficulty=excluded.difficulty,text=excluded.text,options=excluded.options,correct=excluded.correct,active=excluded.active,version=exam_private.questions.version+1;
  end loop;
 elsif p_action='delete_question' then
  delete from exam_private.questions where id=(p_data->>'id')::uuid and course_module_id=p_course_module_id;
  if not found then raise exception 'Вопрос не найден в выбранном модуле';end if;
 else raise exception 'Неизвестная команда банка';end if;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,p_action,p_course_module_id::text,p_data-'questions');
 return jsonb_build_object('ok',true);
end $$;
notify pgrst,'reload schema';
