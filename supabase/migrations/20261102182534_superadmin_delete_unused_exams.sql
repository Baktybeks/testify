create or replace function public.admin_delete_unused_exam(p_module_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); m exam_private.modules; boss boolean; counters int;
begin
 select * into m from exam_private.modules where id=p_module_id for update;
 if not found then raise exception 'Экзамен не найден';end if;
 if p_confirmation is distinct from m.title then raise exception 'Введите точное название экзамена';end if;
 boss:=exists(select 1 from exam_private.profiles where id=actor and role='superadmin');
 if m.status='open' then raise exception 'Сначала закройте приём экзамена';end if;
 if m.status<>'draft' and not boss then raise exception 'Удалить завершённый экзамен может только суперадмин';end if;
 if exists(select 1 from exam_private.attempts where module_id=m.id) or exists(select 1 from exam_private.retake_grants where module_id=m.id) then raise exception 'У экзамена есть история попыток. Удаление запрещено';end if;
 select count(*) into counters from exam_private.attempt_slots where module_id=m.id;
 if counters>0 and not boss then raise exception 'У экзамена есть история запусков. Требуются права суперадмина';end if;
 delete from exam_private.attempt_slots where module_id=m.id;
 delete from exam_private.module_groups where module_id=m.id;

 delete from exam_private.modules where id=m.id;
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,'unused_exam_deleted',m.id::text,jsonb_build_object('title',m.title,'status',m.status,'removed_counters',counters));
 return jsonb_build_object('deleted',true);
end $$;
notify pgrst,'reload schema';
