import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { toast } from "sonner";

/**
 * In-app notifications for chat messages and project updates.
 *
 * Chat read state comes from `chat_participants.last_read_at`. Project update
 * read state is stored per recipient in `project_update_notifications`, so it
 * follows the user across devices and sessions.
 */

const MAX_ITEMS = 30;
const MAX_TOASTS = 3;

/** How long a toast stays on screen before sliding away (client spec: 1s). */
export const TOAST_MS = 1000;

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, created_at, deleted_at";

export type ChatNotification = {
  /** = chat_messages.id, so the same message never notifies twice. */
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  /** Set only for group threads — rendered as "Namn i Gruppnamn". */
  groupName: string | null;
  body: string;
  createdAt: string;
};

export type ProjectUpdateNotification = {
  id: string;
  updateId: string;
  projectId: string;
  projectTitle: string | null;
  createdBy: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

type ConvLite = { id: string; type: "direct" | "group"; name: string | null };
type PersonLite = { id: string; full_name: string | null; avatar_url: string | null };

type ChatContext = {
  convs: Map<string, ConvLite>;
  people: Map<string, PersonLite>;
  lastRead: Record<string, string | null>;
  messages: MessageRow[];
};

const EMPTY_CONTEXT: ChatContext = {
  convs: new Map(),
  people: new Map(),
  lastRead: {},
  messages: [],
};

/** My conversations, their participants' profiles, and the latest messages sent to me. */
async function loadChatContext(selfId: string): Promise<ChatContext> {
  const { data: myRows, error } = await supabase
    .from("chat_participants")
    .select("conversation_id, last_read_at")
    .eq("profile_id", selfId);
  if (error) throw error;

  const lastRead: Record<string, string | null> = {};
  for (const row of myRows ?? []) {
    lastRead[row.conversation_id as string] = row.last_read_at as string | null;
  }
  const convIds = Object.keys(lastRead);
  if (convIds.length === 0) return { ...EMPTY_CONTEXT, convs: new Map(), people: new Map() };

  const [{ data: convRows }, { data: participantRows }, { data: messageRows }] = await Promise.all([
    supabase.from("chat_conversations").select("id, type, name").in("id", convIds),
    supabase
      .from("chat_participants")
      .select("profiles(id, full_name, avatar_url)")
      .in("conversation_id", convIds),
    supabase
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .in("conversation_id", convIds)
      .neq("sender_id", selfId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
  ]);

  const convs = new Map<string, ConvLite>();
  for (const c of convRows ?? []) {
    convs.set(c.id as string, {
      id: c.id as string,
      type: c.type as "direct" | "group",
      name: (c.name as string | null) ?? null,
    });
  }

  const people = new Map<string, PersonLite>();
  for (const row of participantRows ?? []) {
    const p = row.profiles as unknown as PersonLite | null;
    if (p) people.set(p.id, p);
  }

  return { convs, people, lastRead, messages: (messageRows ?? []) as MessageRow[] };
}

function buildNotification(
  row: MessageRow,
  convs: Map<string, ConvLite>,
  people: Map<string, PersonLite>,
): ChatNotification {
  const conv = convs.get(row.conversation_id);
  const sender = people.get(row.sender_id);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: sender?.full_name ?? null,
    senderAvatar: sender?.avatar_url ?? null,
    groupName: conv?.type === "group" ? conv.name || "Grupp" : null,
    body: row.body,
    createdAt: row.created_at,
  };
}

async function loadProjectUpdates(selfId: string): Promise<ProjectUpdateNotification[]> {
  const { data, error } = await supabase
    .from("project_update_notifications")
    .select("id, update_id, project_id, read_at, created_at")
    .eq("recipient_profile_id", selfId)
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS);
  if (error) throw error;
  const rows = data ?? [];
  const updateIds = [...new Set(rows.map((row) => row.update_id as string))];
  const projectIds = [...new Set(rows.map((row) => row.project_id as string))];
  const [{ data: updates }, { data: projects }] = await Promise.all([
    updateIds.length
      ? supabase.from("project_updates").select("id, created_by, body").in("id", updateIds)
      : Promise.resolve({ data: [] as Array<{ id: string; created_by: string | null; body: string }> }),
    projectIds.length
      ? supabase.from("projects").select("id, title").in("id", projectIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
  ]);
  const updateMap = new Map((updates ?? []).map((update) => [update.id as string, update]));
  const titles = new Map((projects ?? []).map((project) => [project.id as string, project.title as string | null]));
  return rows.map((row) => ({
    id: row.id as string,
    updateId: row.update_id as string,
    projectId: row.project_id as string,
    projectTitle: titles.get(row.project_id as string) ?? null,
    createdBy: (updateMap.get(row.update_id as string)?.created_by as string | null) ?? null,
    body: (updateMap.get(row.update_id as string)?.body as string | null) ?? "Projektet har uppdaterats.",
    createdAt: row.created_at as string,
    readAt: row.read_at as string | null,
  }));
}

/** "nu" / "12 min" / "14:32" / "i går 14:32" / "3 jun 14:32" */
export function formatNotificationTime(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "nu";
  if (diffMin < 60) return `${diffMin} min`;

  const time = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `i går ${time}`;

  return `${d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} ${time}`;
}

/** Chat bodies carry `**bold**` markers — strip them for one-line previews. */
export function previewText(body: string): string {
  return body.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

type NotificationsState = {
  /** Newest first, incoming messages only (never my own). */
  items: ChatNotification[];
  unreadCount: number;
  projectUpdates: ProjectUpdateNotification[];
  projectUpdateUnreadCount: number;
  isProjectUpdateUnread: (n: ProjectUpdateNotification) => boolean;
  markProjectUpdateRead: (id: string) => void;
  /** Currently on screen as a popup. */
  toasts: ChatNotification[];
  isUnread: (n: ChatNotification) => boolean;
  dismissToast: (id: string) => void;
  /** Optimistic local clear — the DB write happens when /chatt opens the thread. */
  markConversationRead: (conversationId: string) => void;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsState | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const selfId = user?.id ?? "";
  const chatEnabled = profile?.role === "admin" || profile?.role === "styrelse";
  const projectUpdatesEnabled = profile?.role === "admin" || profile?.role === "entreprenor";

  const [items, setItems] = useState<ChatNotification[]>([]);
  const [projectUpdates, setProjectUpdates] = useState<ProjectUpdateNotification[]>([]);
  const [toasts, setToasts] = useState<ChatNotification[]>([]);
  const [lastRead, setLastRead] = useState<Record<string, string | null>>({});

  const convsRef = useRef<Map<string, ConvLite>>(new Map());
  const peopleRef = useRef<Map<string, PersonLite>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const seenProjectRef = useRef<Set<string>>(new Set());

  // Don't pop a toast for the thread the user is already looking at.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchConv = useRouterState({
    select: (s) => (s.location.search as { c?: string })?.c ?? null,
  });
  const activeConvRef = useRef<string | null>(null);
  activeConvRef.current = pathname === "/chatt" ? searchConv : null;

  const applyContext = useCallback((ctx: ChatContext) => {
    convsRef.current = ctx.convs;
    peopleRef.current = ctx.people;
    setLastRead(ctx.lastRead);
  }, []);

  useEffect(() => {
    if (!selfId) {
      convsRef.current = new Map();
      peopleRef.current = new Map();
      seenRef.current = new Set();
      seenProjectRef.current = new Set();
      setItems([]);
      setProjectUpdates([]);
      setToasts([]);
      setLastRead({});
      return;
    }
    let cancelled = false;
    if (chatEnabled) {
      loadChatContext(selfId)
        .then((ctx) => {
          if (cancelled) return;
          applyContext(ctx);
          const built = ctx.messages.map((m) => buildNotification(m, ctx.convs, ctx.people));
          built.forEach((n) => seenRef.current.add(n.id));
          setItems(built);
        })
        .catch(() => {
          /* A failed backfill just means an empty bell — live messages still arrive. */
        });
    } else {
      setItems([]);
      convsRef.current = new Map();
      peopleRef.current = new Map();
      seenRef.current = new Set();
    }

    if (projectUpdatesEnabled) {
      loadProjectUpdates(selfId)
        .then((rows) => {
          if (cancelled) return;
          rows.forEach((row) => seenProjectRef.current.add(row.id));
          setProjectUpdates(rows);
        })
        .catch(() => {
          /* The project feed remains available if notification backfill fails. */
        });
    } else {
      setProjectUpdates([]);
      seenProjectRef.current = new Set();
    }
    return () => {
      cancelled = true;
    };
  }, [selfId, chatEnabled, projectUpdatesEnabled, applyContext]);

  const pushMessage = useCallback(
    async (row: MessageRow) => {
      if (!selfId || !row?.id) return;
      if (row.sender_id === selfId || row.deleted_at) return;
      if (seenRef.current.has(row.id)) return;

      // A conversation created after mount isn't in the map yet — refetch once,
      // and treat "still unknown" as "not mine" rather than notifying blindly.
      if (!convsRef.current.has(row.conversation_id)) {
        const ctx = await loadChatContext(selfId).catch(() => null);
        if (!ctx) return;
        applyContext(ctx);
        if (!convsRef.current.has(row.conversation_id)) return;
      }
      if (!peopleRef.current.has(row.sender_id)) {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", row.sender_id)
          .maybeSingle();
        if (data) peopleRef.current.set(data.id as string, data as PersonLite);
      }

      seenRef.current.add(row.id);
      const n = buildNotification(row, convsRef.current, peopleRef.current);
      setItems((prev) => [n, ...prev.filter((x) => x.id !== n.id)].slice(0, MAX_ITEMS));
      if (activeConvRef.current !== row.conversation_id) {
        setToasts((prev) => [...prev.filter((x) => x.id !== n.id), n].slice(-MAX_TOASTS));
      }
    },
    [selfId, applyContext],
  );

  const removeMessage = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    if (!selfId) return;
    let channel = supabase.channel(`bayt-notifications-${selfId}`);
    if (chatEnabled) {
      channel = channel
        // No filter: RLS already limits realtime rows to conversations I'm in.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          void pushMessage(payload.new as MessageRow);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, (payload) => {
          const row = payload.new as MessageRow;
          if (row?.deleted_at && row.id) removeMessage(row.id);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, (payload) => {
          const old = payload.old as Partial<MessageRow>;
          if (old?.id) removeMessage(old.id);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_participants", filter: `profile_id=eq.${selfId}` }, (payload) => {
          const row = payload.new as { conversation_id: string; last_read_at: string | null };
          if (row?.conversation_id) setLastRead((prev) => ({ ...prev, [row.conversation_id]: row.last_read_at }));
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_participants", filter: `profile_id=eq.${selfId}` }, () => {
          void loadChatContext(selfId).then(applyContext).catch(() => {});
        });
    }
    if (projectUpdatesEnabled) {
      channel = channel.on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "project_update_notifications",
        filter: `recipient_profile_id=eq.${selfId}`,
      }, (payload) => {
        const row = payload.new as { id: string; update_id: string; project_id: string; created_at: string; read_at: string | null };
        if (!row?.id || seenProjectRef.current.has(row.id)) return;
        seenProjectRef.current.add(row.id);
        void Promise.all([
          supabase.from("project_updates").select("created_by, body").eq("id", row.update_id).maybeSingle(),
          supabase.from("projects").select("title").eq("id", row.project_id).maybeSingle(),
        ]).then(([updateResult, projectResult]) => {
          const update: ProjectUpdateNotification = {
            id: row.id,
            updateId: row.update_id,
            projectId: row.project_id,
            projectTitle: projectResult.data?.title ?? null,
            createdBy: updateResult.data?.created_by ?? null,
            body: updateResult.data?.body ?? "Projektet har uppdaterats.",
            createdAt: row.created_at,
            readAt: row.read_at,
          };
          setProjectUpdates((prev) => [update, ...prev.filter((item) => item.id !== update.id)].slice(0, MAX_ITEMS));
          if (update.createdBy !== selfId && document.visibilityState === "visible") {
            toast("Uppdatering i projekt", {
              description: update.projectTitle ? `${update.projectTitle}: ${update.body}` : update.body,
              action: { label: "Visa", onClick: () => navigate({ to: "/projects/$id", params: { id: update.projectId } }) },
            });
          }
        });
      });
      channel = channel.on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "project_update_notifications",
        filter: `recipient_profile_id=eq.${selfId}`,
      }, (payload) => {
        const row = payload.new as { id: string; read_at: string | null };
        if (row?.id) {
          setProjectUpdates((prev) => prev.map((item) => item.id === row.id ? { ...item, readAt: row.read_at } : item));
        }
      });
    }
    channel = channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfId, chatEnabled, projectUpdatesEnabled, pushMessage, removeMessage, applyContext, navigate]);

  const isUnread = useCallback(
    (n: ChatNotification) => {
      const read = lastRead[n.conversationId];
      return !read || n.createdAt > read;
    },
    [lastRead],
  );

  const markConversationRead = useCallback((conversationId: string) => {
    setLastRead((prev) => ({ ...prev, [conversationId]: new Date().toISOString() }));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!selfId) return;
    const now = new Date().toISOString();
    setLastRead((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) next[id] = now;
      for (const n of items) next[n.conversationId] = now;
      return next;
    });
    if (chatEnabled) {
      await supabase.from("chat_participants").update({ last_read_at: now }).eq("profile_id", selfId);
    }
    if (projectUpdatesEnabled) {
      setProjectUpdates((prev) => prev.map((notification) => notification.readAt ? notification : { ...notification, readAt: now }));
      await supabase
        .from("project_update_notifications")
        .update({ read_at: now })
        .eq("recipient_profile_id", selfId)
        .is("read_at", null);
    }
  }, [selfId, items, chatEnabled, projectUpdatesEnabled, projectUpdates]);

  const markProjectUpdateRead = useCallback((id: string) => {
    if (!selfId || !projectUpdatesEnabled) return;
    const readAt = new Date().toISOString();
    setProjectUpdates((prev) => prev.map((notification) => notification.id === id ? { ...notification, readAt } : notification));
    void supabase
      .from("project_update_notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("recipient_profile_id", selfId)
      .is("read_at", null);
  }, [selfId, projectUpdatesEnabled]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const unreadCount = useMemo(() => items.filter(isUnread).length, [items, isUnread]);
  const isProjectUpdateUnread = useCallback(
    (n: ProjectUpdateNotification) => !n.readAt && n.createdBy !== selfId,
    [selfId],
  );
  const projectUpdateUnreadCount = useMemo(
    () => projectUpdates.filter(isProjectUpdateUnread).length,
    [projectUpdates, isProjectUpdateUnread],
  );

  const value = useMemo<NotificationsState>(
    () => ({
      items,
      unreadCount,
      projectUpdates,
      projectUpdateUnreadCount,
      isProjectUpdateUnread,
      markProjectUpdateRead,
      toasts,
      isUnread,
      dismissToast,
      markConversationRead,
      markAllRead,
    }),
    [items, unreadCount, projectUpdates, projectUpdateUnreadCount, isProjectUpdateUnread, markProjectUpdateRead, toasts, isUnread, dismissToast, markConversationRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
