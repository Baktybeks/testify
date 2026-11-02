create function public.admin_delete_exam_with_history(p_module_id uuid,p_confirmation text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.superadmin();m exam_private.modules;reason text:=trim(p_reason);attempt_count int;result_count int;
begin
 select * into m from exam_private.modules where id=p_module_id for update;
 if not found then raise exception 'Экзамен не найден или уже удалён';end if;
 if p_confirmation is distinct from m.title then raise exception 'Введите точное название экзамена';end if;
 if coalesce(length(reason),0) not between 3 and 1000 then raise exception 'Укажите причину удаления: 3–1000 символов';end if;
 if m.status='open' then raise exception 'Сначала закройте приём экзамена';end if;
 select count(*) into attempt_count from exam_private.attempts where module_id=m.id;
 select count(*) into result_count from exam_private.results r join exam_private.attempts a on a.id=r.attempt_id where a.module_id=m.id;
 delete from exam_private.retake_grants where module_id=m.id;
 delete from exam_private.answers where attempt_id in (select id from exam_private.attempts where module_id=m.id);
 delete from exam_private.commands where attempt_id in (select id from exam_private.attempts where module_id=m.id);
 delete from exam_private.results where attempt_id in (select id from exam_private.attempts where module_id=m.id);
 delete from exam_private.attempt_questions where attempt_id in (select id from exam_private.attempts where module_id=m.id);
 delete from exam_private.attempts where module_id=m.id;
 delete from exam_private.attempt_slots where module_id=m.id;
 delete from exam_private.module_groups where module_id=m.id;
 delete from exam_private.modules where id=m.id;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,'exam_with_history_deleted',m.id::text,jsonb_build_object('title',m.title,'status',m.status,'reason',reason,'attempts',attempt_count,'results',result_count));
 return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.admin_delete_exam_with_history(uuid,text,text) from public,anon;
grant execute on function public.admin_delete_exam_with_history(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
