create function public.admin_attempt_review(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare aid uuid;begin
 perform exam_private.teacher();
 select id into aid from exam_private.attempts where id=p_attempt_id;
 if not found then raise exception 'Попытка не найдена или удалена';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('position',q.position+1,'text',q.text,'options',q.options,'correct_id',q.correct_id,'selected_id',a.option_id,'correct',a.correct,'received_at',a.received_at) order by q.position)
 from exam_private.attempt_questions q left join exam_private.answers a on a.attempt_id=q.attempt_id and a.position=q.position where q.attempt_id=aid),'[]');
end $$;
revoke all on function public.admin_attempt_review(uuid) from public,anon;
grant execute on function public.admin_attempt_review(uuid) to authenticated;
notify pgrst,'reload schema';
