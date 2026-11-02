create index attempt_slots_student_idx on exam_private.attempt_slots(student_id);
create index retake_grants_module_idx on exam_private.retake_grants(module_id,student_id);
create index retake_grants_attempt_idx on exam_private.retake_grants(attempt_id) where attempt_id is not null;
create index attempts_retake_grant_idx on exam_private.attempts(retake_grant_id) where retake_grant_id is not null;
