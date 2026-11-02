-- Only unused drafts can be removed. Real student history is never cascaded.
create function public.admin_delete_unused_exam(p_module_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); m exam_private.modules;
begin
 select * into m from exam_private.modules where id=p_module_id for update;
 if not found then raise exception 'Экзамен не найден';end if;
 if p_confirmation is distinct from m.title then raise exception 'Введите точное название экзамена';end if;
 if m.status<>'draft' then raise exception 'Удалить можно только неиспользованный черновик';end if;
 if exists(select 1 from exam_private.attempts where module_id=m.id) or exists(select 1 from exam_private.attempt_slots where module_id=m.id) or exists(select 1 from exam_private.retake_grants where module_id=m.id) then raise exception 'У экзамена есть история попыток. Удаление запрещено';end if;
 delete from exam_private.module_groups where module_id=m.id;
 delete from exam_private.questions where module_id=m.id;
 delete from exam_private.modules where id=m.id;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,'unused_exam_deleted',m.id::text,jsonb_build_object('title',m.title,'status',m.status));
 return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.admin_delete_unused_exam(uuid,text) from public,anon;
grant execute on function public.admin_delete_unused_exam(uuid,text) to authenticated;
notify pgrst,'reload schema';
