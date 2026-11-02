# Контракт API

Все запросы HTTPS. Для RPC нужны `apikey: <public key>`, `Authorization: Bearer <access token>`, `Content-Type: application/json`. Результат RPC — JSON value. Auth и HTTP-коды обслуживает Supabase. Сгенерированное описание доступно в корне PostgREST с Accept application/openapi+json для авторизованной роли; в репозитории также есть компактная OpenAPI-спецификация.

## Auth

`POST /auth/v1/token?grant_type=password` — штатный Supabase Auth. Студент: email `<login>@students.testify.invalid`, password — личный код. Преподаватель — свой email и пароль. `supabase-js` обновляет access token и сохраняет сессию.

## RPC

Все RPC ниже вызываются POST `/rest/v1/rpc/<name>`.

| Имя | Параметры JSON | Ответ |
|---|---|---|
| my_profile | `{}` | `{id,role,full_name,active}` |
| student_modules | `{}` | Массив `{id,title,status,question_count,seconds_per_question,total_seconds,max_score,available,attempt_id,attempt_status}` |
| attempt_start_or_resume | `{p_module_id:uuid}` | Current |
| attempt_current | `{p_attempt_id:uuid}` | Current |
| attempt_submit_answer | `{p_attempt_id:uuid,p_position:int,p_option_id:uuid,p_key:uuid}` | Current + outcome |
| admin_data | `{p_module_id:uuid|null,p_group_id:string|null}` | `{modules,groups,students,module_groups,attempts,stats}` |
| admin_questions | `{p_module_id:uuid}` | Вопросы банка, включая правильные ответы; только teacher |
| admin_command | `{p_action:string,p_data:object}` | `{ok:true,module_id:uuid|null}` |

Current активной попытки: `{attempt_id,done:false,title,index,total,question,options:[{id,text}],server_now,question_deadline,attempt_deadline}`. Позиция API начинается с 1; в базе с 0. Завершённая: `{attempt_id,done:true,title,total,server_now,attempt_deadline,published}`. Только при published=true добавляются `{score,correct,max_score}`. Outcome: accepted либо expired_or_stale. Старая позиция не применяется к новому вопросу; UI обязан показать актуальный Current.

Идемпотентность: повторите p_key и тот же payload, если подтверждение потерялось. Повтор с изменённым payload отклоняется. Ответ повторного вызова содержит **актуальное состояние попытки**, не старый снимок, и первоначальный outcome команды.

## Команды преподавателя

| p_action | p_data |
|---|---|
| save_module | module_id?:uuid,title,question_count,seconds_per_question,total_seconds,max_score,selection_mode:random/quotas,quotas:object |
| copy_module | module_id |
| transition | module_id,status:open/closed/published/archived |
| save_group | id,name |
| delete_group | id (отклоняется при наличии студентов) |
| group_access | module_id,group_id,access:boolean,window_start:ISO UTC/null,window_end:ISO UTC/null |
| student_status | id,active:boolean |
| rename_student | id,full_name,group_id |
| save_questions | module_id,questions:[{external_id,lecture,difficulty,text,options:string[4],correct:0..3,active:boolean}] |
| delete_question | module_id,id:uuid |

## Аккаунты

`POST /functions/v1/manage-account`, с Authorization и допустимым Origin:

- `{action:"create",id,login,full_name,group_id}` → `{id,code}`.
- `{action:"reset",id}` → `{code}`.

Только teacher. code возвращается один раз и не логируется. Создание Auth + профиля — две системы; при SQL-ошибке функция пытается удалить только что созданный Auth account. Ошибки компенсации логируются для ручной проверки.

## Ошибки

PostgREST: `{code,message,details,hint}`. SQL 42501 — запрещено (HTTP 403 для authenticated), 23505 — конфликт уникальности (409), P0001 — нарушение бизнес-правила (400), прочие коды — согласно PostgREST. Отсутствующий/некорректный JWT обычно 401. Ошибка лимита SQL пока возвращается как P0001/400 с сообщением, а не 429. Edge: `{error:string}` с HTTP 400/401/403/405/413/429. Frontend выводит message; секреты и ключи ответов в ошибки не включаются.
