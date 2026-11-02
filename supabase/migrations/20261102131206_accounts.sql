create function public.admin_student_auth(p_id text) returns uuid language plpgsql security definer set search_path='' as $$
begin perform exam_private.teacher();return (select auth_id from exam_private.students where id=p_id);end $$;
create function public.admin_account_limit() returns boolean language plpgsql security definer set search_path='' as $$
begin perform exam_private.teacher();perform exam_private.throttle('account',30);return true;end $$;
revoke all on function public.admin_student_auth(text),public.admin_account_limit() from public,anon;
grant execute on function public.admin_student_auth(text),public.admin_account_limit() to authenticated;
