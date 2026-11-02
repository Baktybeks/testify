-- Preserve imported blocked status atomically with student creation.
create function public.service_register_student_with_status(p_auth_id uuid,p_id text,p_login text,p_name text,p_group text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into exam_private.profiles values(p_auth_id,'student',p_name,p_active);
 insert into exam_private.students values(p_id,p_auth_id,p_login,p_group);
 insert into exam_private.audit_logs(actor,action,target) values(null,'account_created',p_id);
end $$;
revoke all on function public.service_register_student_with_status(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.service_register_student_with_status(uuid,text,text,text,text,boolean) to service_role;
