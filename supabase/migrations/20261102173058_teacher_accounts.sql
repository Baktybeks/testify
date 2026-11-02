create function public.superadmin_teachers() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform exam_private.superadmin();
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',u.email,'role',p.role,'active',p.active,'created_at',u.created_at) order by p.full_name)
 from exam_private.profiles p join auth.users u on u.id=p.id where p.role in ('teacher','superadmin')),'[]');
end $$;
create function public.service_register_teacher(p_actor uuid,p_auth_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Recheck the actor at the SQL commit boundary; browsers cannot call this function.
 perform 1 from exam_private.profiles where id=p_actor and active and role='superadmin' for share;
 if not found then raise exception 'Требуются права суперадмина' using errcode='42501';end if;
 if coalesce(length(trim(p_name)),0) not between 2 and 150 then raise exception 'Укажите ФИО преподавателя: 2–150 символов';end if;
 insert into exam_private.profiles(id,role,full_name,active) values(p_auth_id,'teacher',trim(p_name),true);
 insert into exam_private.audit_logs(actor,action,target,details) values(p_actor,'teacher_created',p_auth_id::text,jsonb_build_object('full_name',trim(p_name),'role','teacher'));
end $$;
revoke all on function public.superadmin_teachers() from public,anon;
grant execute on function public.superadmin_teachers() to authenticated;
revoke all on function public.service_register_teacher(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_register_teacher(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
