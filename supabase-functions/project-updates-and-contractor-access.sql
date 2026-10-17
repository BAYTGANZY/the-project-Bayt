-- Project work updates and counterpart notifications.
-- Run once in the Supabase SQL editor before deploying the frontend.

CREATE TABLE IF NOT EXISTS public.project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_updates_project_created_idx
  ON public.project_updates (project_id, created_at DESC);

ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_updates_read_participants ON public.project_updates;
CREATE POLICY project_updates_read_participants ON public.project_updates
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR (
      is_contractor()
      AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_updates.project_id
          AND p.assigned_contact_id = my_contact_id()
      )
    )
  );

DROP POLICY IF EXISTS project_updates_add_participants ON public.project_updates;
CREATE POLICY project_updates_add_participants ON public.project_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      is_admin()
      OR (
        is_contractor()
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = project_updates.project_id
            AND p.assigned_contact_id = my_contact_id()
        )
      )
    )
  );

REVOKE ALL ON public.project_updates FROM anon, PUBLIC, authenticated;
GRANT SELECT ON public.project_updates TO authenticated;
GRANT INSERT (project_id, created_by, body) ON public.project_updates TO authenticated;

CREATE TABLE IF NOT EXISTS public.project_update_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL REFERENCES public.project_updates(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE (update_id, recipient_profile_id)
);

CREATE INDEX IF NOT EXISTS project_update_notifications_recipient_idx
  ON public.project_update_notifications (recipient_profile_id, created_at DESC);

ALTER TABLE public.project_update_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_update_notifications_read_own ON public.project_update_notifications;
CREATE POLICY project_update_notifications_read_own ON public.project_update_notifications
  FOR SELECT TO authenticated
  USING (
    recipient_profile_id = auth.uid()
    AND (
      is_admin()
      OR (
        is_contractor()
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = project_update_notifications.project_id
            AND p.assigned_contact_id = my_contact_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS project_update_notifications_mark_own_read ON public.project_update_notifications;
CREATE POLICY project_update_notifications_mark_own_read ON public.project_update_notifications
  FOR UPDATE TO authenticated
  USING (
    recipient_profile_id = auth.uid()
    AND (
      is_admin()
      OR (
        is_contractor()
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = project_update_notifications.project_id
            AND p.assigned_contact_id = my_contact_id()
        )
      )
    )
  )
  WITH CHECK (
    recipient_profile_id = auth.uid()
    AND (
      is_admin()
      OR (
        is_contractor()
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = project_update_notifications.project_id
            AND p.assigned_contact_id = my_contact_id()
        )
      )
    )
  );

REVOKE ALL ON public.project_update_notifications FROM anon, PUBLIC, authenticated;
GRANT SELECT ON public.project_update_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.project_update_notifications TO authenticated;

-- A contractor may use the existing lifecycle buttons and viewed marker, but
-- cannot change the project's ownership, assignment, description, dates, or
-- budget. Work details are written to project_updates instead.
CREATE OR REPLACE FUNCTION public.protect_contractor_project_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_contractor() THEN
    IF OLD.assigned_contact_id IS DISTINCT FROM my_contact_id() THEN
      RAISE EXCEPTION 'Projektet är inte tilldelat ditt konto.' USING ERRCODE = '42501';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['viewed_at', 'updated_at', 'status', 'arende_status'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['viewed_at', 'updated_at', 'status', 'arende_status']) THEN
      RAISE EXCEPTION 'Entreprenörer kan bara uppdatera arbetsinformation och ärendestatus.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_contractor_project_fields_trg ON public.projects;
CREATE TRIGGER protect_contractor_project_fields_trg
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_contractor_project_fields();

-- Every meaningful project change creates a visible update row. The generic
-- message avoids copying private fields such as budget into the notification.
CREATE OR REPLACE FUNCTION public.record_project_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['viewed_at', 'updated_at'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['viewed_at', 'updated_at']) THEN
    INSERT INTO public.project_updates (project_id, created_by, body)
    VALUES (NEW.id, auth.uid(), 'Projektinformationen har uppdaterats.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_project_change_trg ON public.projects;
CREATE TRIGGER record_project_change_trg
  AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.record_project_change();

CREATE OR REPLACE FUNCTION public.record_project_image_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_updates (project_id, created_by, body)
  VALUES (NEW.project_id, COALESCE(auth.uid(), NEW.uploaded_by), 'En ny bild har lagts till i projektet.');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_project_image_update_trg ON public.project_images;
CREATE TRIGGER record_project_image_update_trg
  AFTER INSERT ON public.project_images
  FOR EACH ROW EXECUTE FUNCTION public.record_project_image_update();

-- Persist a private notification for the other party. Admin updates notify the
-- assigned contractor; contractor updates notify each BAYT admin account.
CREATE OR REPLACE FUNCTION public.notify_project_update_recipients()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_contractor_profile_id UUID;
BEGIN
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

  SELECT role::text INTO v_actor_role
    FROM public.profiles
   WHERE id = NEW.created_by;

  IF v_actor_role = 'admin' THEN
    SELECT c.profile_id INTO v_contractor_profile_id
      FROM public.projects p
      JOIN public.contacts c ON c.id = p.assigned_contact_id
     WHERE p.id = NEW.project_id;
    IF v_contractor_profile_id IS NOT NULL AND v_contractor_profile_id <> NEW.created_by THEN
      INSERT INTO public.project_update_notifications (update_id, project_id, recipient_profile_id)
      VALUES (NEW.id, NEW.project_id, v_contractor_profile_id)
      ON CONFLICT (update_id, recipient_profile_id) DO NOTHING;
    END IF;
  ELSIF v_actor_role = 'entreprenor' THEN
    INSERT INTO public.project_update_notifications (update_id, project_id, recipient_profile_id)
    SELECT NEW.id, NEW.project_id, p.id
      FROM public.profiles p
     WHERE p.role::text = 'admin'
       AND p.id <> NEW.created_by
    ON CONFLICT (update_id, recipient_profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_project_update_recipients_trg ON public.project_updates;
CREATE TRIGGER notify_project_update_recipients_trg
  AFTER INSERT ON public.project_updates
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_update_recipients();

-- Realtime lets both parties receive updates while they are in the portal.
DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN RETURN; END IF;
  FOREACH v_table_name IN ARRAY ARRAY['project_updates', 'project_update_notifications'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
    END IF;
  END LOOP;
END;
$$;

-- Read-only verification: expect the participant policies and four triggers.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'project_updates'
 ORDER BY policyname;

SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'project_update_notifications'
 ORDER BY policyname;

SELECT event_object_table, trigger_name, event_manipulation
  FROM information_schema.triggers
 WHERE trigger_schema = 'public'
   AND trigger_name IN (
     'protect_contractor_project_fields_trg',
     'record_project_change_trg',
     'record_project_image_update_trg',
     'notify_project_update_recipients_trg'
   )
 ORDER BY event_object_table, trigger_name;
