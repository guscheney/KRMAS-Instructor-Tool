-- Test fixtures (local). Users across two schools + a network superadmin.
truncate auth.users cascade;
truncate public.students, public.incidents, public.audit_log, public.kv_store,
         public.notices, public.feed_posts, public.class_assignments,
         public.calendar_events, public.documents, public.instructor_compliance,
         public.push_subscriptions restart identity cascade;
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000001','sa@krmas'),
  ('00000000-0000-0000-0000-0000000000a1','ad.e@krmas'),
  ('00000000-0000-0000-0000-0000000000b1','in.e@krmas'),
  ('00000000-0000-0000-0000-0000000000c1','jr.e@krmas'),
  ('00000000-0000-0000-0000-0000000000a2','ad.b@krmas'),
  ('00000000-0000-0000-0000-0000000000b2','in.b@krmas');

insert into public.profiles(id,role,school_id,display_name) values
  ('00000000-0000-0000-0000-000000000001','superadmin', null,        'Super'),
  ('00000000-0000-0000-0000-0000000000a1','admin',      'edgeworth', 'Admin E'),
  ('00000000-0000-0000-0000-0000000000b1','instructor', 'edgeworth', 'Instr E'),
  ('00000000-0000-0000-0000-0000000000c1','junior',     'edgeworth', 'Junior E'),
  ('00000000-0000-0000-0000-0000000000a2','admin',      'beecroft',  'Admin B'),
  ('00000000-0000-0000-0000-0000000000b2','instructor', 'beecroft',  'Instr B')
on conflict (id) do update set role=excluded.role, school_id=excluded.school_id;

insert into public.students(id,school_id,name,dob) values
  ('S-E1','edgeworth','Ed Student 1','2012-01-01'),
  ('S-E2','edgeworth','Ed Student 2','2013-02-02'),
  ('S-B1','beecroft','Bee Student 1','2011-03-03')
on conflict (id) do nothing;

insert into public.incidents(id,school_id,data,created_by) values
  ('I-E1','edgeworth','{"note":"edgeworth incident"}','00000000-0000-0000-0000-0000000000b1'),
  ('I-B1','beecroft','{"note":"beecroft incident"}','00000000-0000-0000-0000-0000000000b2')
on conflict (id) do nothing;

insert into public.notices(id,school_id,title) values
  ('N-E','edgeworth','Edgeworth notice'),('N-NET',null,'Network notice')
on conflict (id) do nothing;

insert into public.feed_posts(id,school_id,author_id,author_name,body,target_scope) values
  ('P-E','edgeworth','00000000-0000-0000-0000-0000000000b1','Instr E','school post','school'),
  ('P-NET',null,'00000000-0000-0000-0000-000000000001','Super','net post','network')
on conflict (id) do nothing;

insert into public.class_assignments(school_id,instructor_id,slot_key) values
  ('edgeworth','00000000-0000-0000-0000-0000000000b1','1-16:00-little-ninjas')
on conflict do nothing;

insert into public.calendar_events(id,school_id,title,start_date,end_date) values
  ('C-E','edgeworth','Edgeworth event','2026-07-01','2026-07-01')
on conflict (id) do nothing;

insert into public.documents(id,school_id,title,filename,mime_type) values
  ('D-E','edgeworth','Policy','p.pdf','application/pdf')
on conflict (id) do nothing;

insert into public.instructor_compliance(id,school_id,instructor_id,requirement_id) values
  ('IC-E','edgeworth','00000000-0000-0000-0000-0000000000b1','wwc')
on conflict (id) do nothing;

insert into public.push_subscriptions(user_id,school_id,endpoint,keys_p256dh,keys_auth) values
  ('00000000-0000-0000-0000-0000000000b1','edgeworth','https://push/e1','k','a'),
  ('00000000-0000-0000-0000-0000000000b2','beecroft','https://push/b1','k','a')
on conflict (endpoint) do nothing;

-- kv blobs: legacy students/incidents/pin-overrides (must now be DENIED to everyone),
-- plus live domains for role/school tests.
insert into public.kv_store(school_id,key,value) values
  ('edgeworth','grading','{"x":1}'),
  ('edgeworth','lesson-plans','{"x":1}'),
  ('beecroft','grading','{"x":1}'),
  ('global','custom-schools','{"x":1}'),
  ('edgeworth','students','{"leaked":1}'),
  ('edgeworth','incidents','{"leaked":1}'),
  ('edgeworth','pin-overrides','{"leaked":1}')
on conflict (school_id,key) do nothing;
