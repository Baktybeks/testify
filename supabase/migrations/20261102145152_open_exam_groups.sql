create function public.admin_open_exam_groups(p_module_id uuid,p_group_ids text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=exam_private.teacher(); m exam_private.modules; selected text[]; expired text; result jsonb;
begin
 perform exam_private.throttle('admin',120);
 select * into strict m from exam_private.modules where id=p_module_id for update;
 if m.status not in ('draft','closed') then raise exception 'Открытие доступно только для черновика или закрытого экзамена';end if;
 select array_agg(distinct g order by g) into selected from unnest(p_group_ids)g where g is not null;
 if coalesce(cardinality(selected),0)=0 then raise exception 'Выберите хотя бы одну группу';end if;
 if exists(select 1 from unnest(selected)g where not exists(select 1 from exam_private.groups where id=g)) then raise exception 'Одна из выбранных групп не найдена. Обновите список.';end if;
 perform 1 from exam_private.groups where id=any(selected) order by id for share;
 select g.name into expired from exam_private.module_groups mg join exam_private.groups g on g.id=mg.group_id
 where mg.module_id=p_module_id and mg.group_id=any(selected) and mg.window_end<=clock_timestamp() limit 1;
 if expired is not null then raise exception 'Окно сдачи группы % истекло. Измените его в разделе «Группы».',expired;end if;
 update exam_private.module_groups set access=false where module_id=p_module_id;
 insert into exam_private.module_groups(module_id,group_id,access) select p_module_id,g,true from unnest(selected)g
 on conflict(module_id,group_id) do update set access=true;
 -- Transition checks the bank and quota readiness in the same transaction.
 result:=exam_private.admin_command_base('transition',jsonb_build_object('module_id',p_module_id,'status','open'));
 insert into exam_private.audit_logs(actor,action,target,details) values(actor,'open_exam_groups',p_module_id::text,jsonb_build_object('group_ids',selected));
 return result||jsonb_build_object('group_ids',selected);
end $$;
revoke all on function public.admin_open_exam_groups(uuid,text[]) from public,anon;
grant execute on function public.admin_open_exam_groups(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
