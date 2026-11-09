import { landsOnNewChat, returnsToNewChat, slotForTime, todayIn } from '@cycling-coach/core';
import type { IsoDate, MealIdeas, Proposal, RecipeDraft, ThreadSummary, ThreadView, UiBlock, UiMessage, Workout } from '@cycling-coach/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Fragment, memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AppBar, IconButton } from '../../components/AppBar';
import { BrandTile } from '../../components/BrandTile';
import { ArrowUpIcon, BookmarkIcon, BulbIcon, ComposeIcon, MenuIcon, SendIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { Button, ErrorNote, PageHeader } from '../../components/ui';
import { useExtensions } from '../../extensions';
import { api, unwrap } from '../../lib/api';
import { useFoodLibrary } from '../../lib/foodQueries';
import { keys, threadQuery, THREADS_PAGE, threadsQuery, useCoachCheck, useDashboard, useThread, useThreads, useUsage } from '../../lib/queries';
import { settleMarkdown } from '../../lib/textPacer';
import { abortTurn, clearDoneTurn, patchTurn, runningThreadId, setWatching, startTurn, useLiveTurn, type LiveTurn, type TurnError as TurnErrorInfo, type TurnOrigin } from '../../lib/coachTurn';
import { useAwayReturn } from '../../lib/useAwayReturn';
import { useIsMobile } from '../../lib/useIsMobile';
import { MemoryChip, OutlookChip, ProposalBlock, RequestChangesContext, TextBlock, ToolChip, WorkoutBlock } from './blocks';
import { dayLabel } from '../food/dayLabel';
import { useFoodFlows } from '../food/flows';
import { CoachFoodContext, FoodLogOfferBlock, MealIdeasBlock, RecipeRefBlock, type CoachFoodActions } from './foodBlocks';
import { FoodStrip } from './FoodStrip';
import { IdeaDetailsPane } from './IdeaDetailsPane';
import { CoachWorking } from './CoachWorking';
import { useChatScroll } from './useChatScroll';
import { LongChatNotice } from './LongChatNotice';
import { MemoryPanel, useMemoryNotes } from './MemoryPanel';
import { RecipePane, RecipePaneSkeleton } from './RecipePane';
import { ConnectNudgeRow } from './ConnectNudge';
import { RightRail, TodayStrip } from './RightRail';
import { SuggestionsMenu } from './SuggestionsMenu';

const SUGGESTIONS = ['What should I ride today?', 'Pull my last 7 days', 'Build a new workout', 'Plan next week'];

/** What the thread view's id-only cards look up. */
interface CardData {
  proposals: Map<string, Proposal>;
  workouts: Map<string, Workout>;
  mealIdeas: Map<string, MealIdeas>;
  recipeDrafts: Map<string, RecipeDraft>;
}
const NO_CARDS: CardData = { proposals: new Map(), workouts: new Map(), mealIdeas: new Map(), recipeDrafts: new Map() };

const isFoodBlock = (b: UiBlock) => b.type === 'meal_ideas' || b.type === 'recipe_ref';

type ThreadFilter = 'all' | 'training' | 'food';

/** Where the coach started afresh, so a forgotten detail isn't a surprise (DECISIONS #80, #93). */
function ContextBreak({ reset }: { reset: boolean }) {
  return (
    <div role="separator" className="flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-auto bg-line" />
      {reset ? 'Your coach no longer sees earlier messages' : 'Earlier messages are summarized for your coach'}
      <span className="h-px flex-auto bg-line" />
    </div>
  );
}

/** Mobile drops the avatar so coach messages run full width. */
function CoachAvatar() {
  return <BrandTile size={32} radius={9} className="mobile:hidden" />;
}

function AssistantBlocks({ blocks, threadId, cards, live = false }: { blocks: UiBlock[]; threadId: string; cards: CardData; live?: boolean }) {
  const { proposals, workouts, mealIdeas, recipeDrafts } = cards;
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'text':
            return <TextBlock key={i} text={live ? settleMarkdown(b.text) : b.text} />;
          case 'tool':
            return <ToolChip key={b.toolUseId || i} block={b} />;
          case 'proposal':
            return <ProposalBlock key={b.proposalId} id={b.proposalId} threadId={threadId} initial={proposals.get(b.proposalId)} />;
          case 'workout':
            return <WorkoutBlock key={b.workoutId} id={b.workoutId} initial={workouts.get(b.workoutId)} />;
          case 'memory':
            return <MemoryChip key={`${b.memoryId}-${b.action}-${i}`} block={b} />;
          case 'meal_ideas':
            return <MealIdeasBlock key={b.ideasId} id={b.ideasId} initial={mealIdeas.get(b.ideasId)} />;
          case 'recipe_ref':
            return <RecipeRefBlock key={b.draftId} id={b.draftId} initial={recipeDrafts.get(b.draftId)} />;
          case 'food_log_offer':
            return <FoodLogOfferBlock key={i} phrase={b.phrase} />;
          case 'outlook':
            return <OutlookChip key={i} block={b} />;
        }
      })}
    </>
  );
}

/** Memoised: the live reply updates many times a second, and old messages shouldn't re-parse their markdown each time. */
const MessageRow = memo(function MessageRow({ message, view, cards }: { message: UiMessage; view: ThreadView | undefined; cards: CardData }) {
  if (message.role === 'user') {
    const text = message.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    return (
      <div data-user-row className="max-w-[78%] self-end rounded-[16px_16px_4px_16px] bg-user-bubble px-4 py-3.5 whitespace-pre-wrap mobile:max-w-[85%] mobile:py-3">{text}</div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <CoachAvatar />
      <div className="flex min-w-0 flex-auto flex-col gap-3.5">
        <AssistantBlocks blocks={message.blocks} threadId={view?.thread.id ?? ''} cards={cards} />
      </div>
    </div>
  );
});

/** In place of the composer while the coach can't take a message, so nobody writes one only to be refused (DECISIONS #76). */
function CoachLocked({ refusal }: { refusal: { message: string; action?: { label: string; href: string } | undefined } }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-[#F3DFA4] bg-[#FFF6DD] px-3.5 py-2.5 text-[13px] text-[#5C3A05]">
      <p className="m-0 min-w-0 flex-[1_1_240px]">{refusal.message}</p>
      {refusal.action && (
        <a href={refusal.action.href} className="flex min-h-9 flex-none items-center rounded-[10px] bg-ink px-3.5 font-semibold text-white no-underline hover:text-white">
          {refusal.action.label}
        </a>
      )}
    </div>
  );
}

function TurnError({ error, onRetry }: { error: TurnErrorInfo; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote>{error.message}</ErrorNote>
      {error.action && (
        <a href={error.action.href} className="self-start rounded-[10px] bg-accent px-3 py-2 text-[13px] font-semibold text-on-accent no-underline">
          {error.action.label}
        </a>
      )}
      {error.retryable && (
        <Button size="sm" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const matchesFilter = (t: ThreadSummary, f: ThreadFilter) => f === 'all' || (f === 'food') === t.tags.includes('food');

function FoodTag() {
  return <span className="rounded-[5px] bg-[#FFF4E5] px-1.5 text-[10px] leading-[17px] font-bold text-[#B54708]">Food</span>;
}

function ThreadList({ current, onPick }: { current?: string | undefined; onPick: (id: string) => void }) {
  const [limit, setLimit] = useState(THREADS_PAGE);
  const { data, isPlaceholderData } = useThreads(limit);
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const hasFood = !!data?.some((t) => t.tags.includes('food'));
  const shown = data?.filter((t) => matchesFilter(t, filter));
  return (
    <>
      {hasFood && (
        <div className="flex gap-1 px-2 pt-1 pb-2" role="group" aria-label="Show threads">
          {(['all', 'training', 'food'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-8 rounded-full border px-2.5 text-xs capitalize mobile:min-h-[40px] ${filter === f ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {!shown?.length && <div className="p-3 text-[13px] text-muted">No conversations yet.</div>}
      {shown?.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.id)}
          className={`flex w-full flex-col items-start rounded-lg border-0 px-3 py-2 text-left mobile:min-h-[48px] ${t.id === current ? 'bg-hover' : 'bg-transparent hover:bg-surface-2'}`}
        >
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            {t.title}
            {t.tags.includes('food') && <FoodTag />}
          </span>
          <span className="text-xs text-muted">{new Date(t.lastMessageAt).toLocaleString()}</span>
        </button>
      ))}
      {data?.length === limit && (
        <button type="button" disabled={isPlaceholderData} onClick={() => setLimit((n) => n + THREADS_PAGE)} className="min-h-9 w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[13px] font-medium text-accent-ink hover:bg-surface-2 mobile:min-h-[48px]">
          {isPlaceholderData ? 'Loading…' : 'Show older'}
        </button>
      )}
    </>
  );
}

function ThreadsMenu({ current, onPick }: { current?: string | undefined; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Threads
      </Button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-96 w-72 overflow-auto rounded-[10px] border border-line bg-surface p-1 shadow-lg">
          <ThreadList
            current={current}
            onPick={(id) => {
              setOpen(false);
              onPick(id);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CoachPage({
  threadId,
  isNew,
  left,
  prompt,
  recipe,
  idea,
}: {
  threadId?: string | undefined;
  isNew?: boolean | undefined;
  /** The chat a long break left behind, which the Continue link goes back to. */
  left?: string | undefined;
  /** Pre-fills the composer (Library "Edit with coach", Calendar "Ask coach"). */
  prompt?: string | undefined;
  /** A coach recipe open in the right-hand pane. */
  recipe?: string | undefined;
  /** A meal idea's Details pane, "{ideasId}.{index}". */
  idea?: string | undefined;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threads = useThreads();
  const thread = useThread(threadId);
  const [draft, setDraft] = useState(prompt ?? '');
  const [refused, setRefused] = useState<TurnErrorInfo | null>(null);
  const [forBuild, setForBuild] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const { coachNotice: CoachNotice, coachCopy } = useExtensions();
  const buildModel = useUsage().data?.buildModel ?? null;
  useEffect(() => {
    if (prompt) setDraft(prompt);
  }, [prompt]);
  // The live turn lives in a store, so it survives leaving Coach (DECISIONS #46).
  const live: LiveTurn | null = useLiveTurn(threadId);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The meal and day food ideas are for: picked in the strip, else now's slot today.
  const dashboard = useDashboard().data;
  const lib = useFoodLibrary().data;
  const today: IsoDate = dashboard?.today ?? todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date());
  const [foodPick, setFoodPick] = useState<{ slot: string; date: IsoDate } | null>(null);
  const nowSlot = useMemo(() => {
    if (!lib) return 'Dinner';
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: dashboard?.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    return slotForTime(lib.settings.slots, hhmm);
  }, [lib, dashboard?.timezone]);
  // Log this works from today, not the strip's planning day, or "yesterday" would be counted from there.
  const flows = useFoodFlows({ lib, date: today, dateLabel: dayLabel(today, today), defaultSlot: nowSlot });
  // The coach's latest ideas name the meal it's planning ("Ideas for dinner" at 11 pm is still dinner).
  const lastIdeas = thread.data?.mealIdeas.at(-1);
  const planned = lastIdeas && lastIdeas.date >= today ? lastIdeas : undefined;
  const foodSlot = foodPick?.slot ?? planned?.slot ?? nowSlot;
  const foodDate = foodPick?.date ?? planned?.date ?? today;
  useEffect(() => setFoodPick(null), [threadId]);

  // One pane at a time: a recipe or a meal idea's details.
  const openRecipe = (id: string) => void navigate({ to: '/', search: ({ idea: _i, ...s }) => ({ ...s, recipe: id }) });
  const closeRecipe = () => void navigate({ to: '/', search: ({ recipe: _r, ...s }) => s });
  const openIdea = (key: string) => void navigate({ to: '/', search: ({ recipe: _r, ...s }) => ({ ...s, idea: key }), replace: !!idea });
  const closeIdea = () => void navigate({ to: '/', search: ({ idea: _i, ...s }) => s });
  const [ideasId, ideaIndex] = idea ? (idea.split('.') as [string, string]) : [];
  // Servings picked for an idea before Make this (DECISIONS #47); the card and Details pane share it.
  const [ideaServings, setIdeaServings] = useState<Record<string, number>>({});
  const servingsFor = (key: string, i: { servings: number }) => ideaServings[key] ?? i.servings;
  const setServings = (key: string, n: number) => setIdeaServings((m) => ({ ...m, [key]: n }));

  // Land on a recent conversation, like reopening the claude.ai chat. After a break it's a new one,
  // or one chat would grow for ever (DECISIONS #80, #82). A running turn always wins (#46).
  const latest = threads.data?.[0];
  const resume = threads.data?.find((t) => t.id === left) ?? latest;
  const wentQuiet = !!latest && landsOnNewChat(new Date(latest.lastMessageAt), new Date());
  useEffect(() => {
    if (threadId || isNew || live) return;
    const target = runningThreadId() ?? (latest && !wentQuiet ? latest.id : undefined);
    if (target) void navigate({ to: '/', search: { t: target }, replace: true });
  }, [threadId, isNew, latest, wentQuiet, live, navigate]);

  // A page left open on a chat never reloads, so the rule above never runs: a phone left on a chat
  // overnight would wake up on it. Anything the athlete is partway through keeps them there.
  const shownThread = useRef(threadId);
  shownThread.current = threadId;
  const inTheMiddle = useRef<() => boolean>(() => true);
  inTheMiddle.current = () => !!live || !!runningThreadId() || !!draft.trim() || !!recipe || !!idea || !!document.querySelector('[role="dialog"]');
  useAwayReturn({
    threadId,
    latestAt: thread.data?.thread.lastMessageAt,
    onReturn: async (away) => {
      if (!threadId || inTheMiddle.current()) return;
      // Fresh: a reply may have landed while they were gone, and landing has to see what's new.
      const view = await Promise.all([qc.fetchQuery({ ...threadQuery(threadId), staleTime: 0 }), qc.fetchQuery({ ...threadsQuery(), staleTime: 0 })]).then(
        ([fresh]) => fresh,
        () => null,
      );
      // Their own message last means a turn that was lost, which needs its Try again.
      if (!view || shownThread.current !== threadId || inTheMiddle.current() || view.messages.at(-1)?.role === 'user') return;
      if (returnsToNewChat(away, new Date(view.thread.lastMessageAt), new Date())) void navigate({ to: '/', search: { left: threadId } });
    },
  });

  // Tell the store which thread is on screen (a turn that finishes elsewhere leaves a notice), and
  // drop a finished turn's error once the user moves on — it belongs to the thread it happened in.
  useEffect(() => {
    setWatching(threadId ?? null);
    return () => {
      setWatching(null);
      clearDoneTurn(threadId);
    };
  }, [threadId]);

  // A recipe the coach just built opens on the right, as the coach says it does (phones tap the card).
  const readyRecipe = live?.readyRecipe;
  useEffect(() => {
    if (!readyRecipe || !threadId) return;
    patchTurn(threadId, { readyRecipe: undefined });
    if (!mobile) openRecipe(readyRecipe);
  }, [readyRecipe]);

  const streaming = !!live && !live.done;
  const scroll = useChatScroll({ threadId, loaded: !!thread.data, turnStart: live?.startedAt, streaming });
  // Fails open: a check that can't be read leaves the composer, and the server still refuses.
  const blocked = useCoachCheck().data?.refused ?? null;
  // A turn just spent money, which may have been the last of it.
  useEffect(() => {
    if (!streaming) void qc.invalidateQueries({ queryKey: keys.coachCheck });
  }, [streaming, qc]);
  // "Make this" pressed: that card says "Writing recipe…" and the right column waits for the recipe.
  const makingKey = streaming && live?.origin?.kind === 'make' ? live.origin.ideaKey : undefined;
  const writingRecipe = !!makingKey && !live?.readyRecipe && !mobile;

  const requestChanges = (title: string) => fillDraft(`Change "${title}": `);

  function fillDraft(text: string) {
    setDraft(text);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(text.length, text.length);
    });
  }

  async function send(text: string, origin?: TurnOrigin) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setDraft('');
    setRefused(null);
    const useBuildModel = forBuild;
    setForBuild(false);
    let id = threadId;
    if (!id) {
      // Ask first: a refusal after creating the thread would leave an empty one behind.
      const stop = await unwrap(await api.api.coach.check.$get());
      if (stop.refused) {
        setRefused({ message: stop.refused.message, retryable: false, action: stop.refused.action });
        setDraft(trimmed);
        return;
      }
      const created = await unwrap(await api.api.threads.$post());
      id = created.id;
      // Only while still on Coach: the app never pulls the user back here (DECISIONS #46).
      if (mountedRef.current) void navigate({ to: '/', search: { t: id }, replace: true });
    }
    scroll.anchorNext();
    const { refused } = await startTurn({
      threadId: id,
      input: { text: trimmed, ...(foodPick ? { food: foodPick } : {}), ...(useBuildModel ? { useBuildModel } : {}) },
      baseCount: id === threadId ? (thread.data?.messages.length ?? 0) : 0,
      qc,
      origin,
    });
    // Nothing was stored, so give the words back.
    if (refused && mountedRef.current) setDraft((current) => current || trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  const view = thread.data;
  const stored = view?.messages ?? [];
  const cards = useMemo<CardData>(
    () =>
      view
        ? {
            proposals: new Map(view.proposals.map((p) => [p.id, p])),
            workouts: new Map(view.workouts.map((w) => [w.id, w])),
            mealIdeas: new Map(view.mealIdeas.map((m) => [m.id, m])),
            recipeDrafts: new Map(view.recipeDrafts.map((d) => [d.id, d])),
          }
        : NO_CARDS,
    [view],
  );
  const isFood = !!view?.thread.tags.includes('food') || !!live?.blocks.some(isFoodBlock);
  const suggestions = [...SUGGESTIONS, `Ideas for ${foodSlot.toLowerCase()}`];
  const showLive = !!live && (!live.synced || stored.length === live.baseCount);
  const lateError = live?.error && !showLive ? live.error : null;
  // A running turn stores its messages as it goes, and anything can refetch them (accepting its card,
  // its title, coming back to the window). The live copy is the one on screen until it's finished.
  const messages = showLive ? stored.slice(0, live.baseCount) : stored;
  // A retry of an unanswered message: the server reuses it, so don't draw the bubble twice.
  const lastMessage = messages[messages.length - 1];
  const retryingLast =
    !!live &&
    lastMessage?.role === 'user' &&
    lastMessage.blocks.some((b) => b.type === 'text' && b.text === live.userText);

  const foodActions: CoachFoodActions = { send: (t, o) => void send(t, o), openRecipe, openId: recipe, openIdea, openIdeaKey: idea, busy: streaming, makingKey, servingsFor, setServings, logWords: (p) => flows.words(p) };
  const title = view?.thread.title ?? (threadId ? '…' : 'Coach');
  const memory = useMemoryNotes(today);
  const memoryLabel = `Coach memory, ${memory.notes.length} ${memory.notes.length === 1 ? 'note' : 'notes'}${memory.toReview > 0 ? `, ${memory.toReview} to review` : ''}`;
  const newChat = () => {
    clearDoneTurn(threadId);
    void navigate({ to: '/', search: { new: true } });
  };

  return (
    <div className="@container flex min-h-dvh flex-wrap mobile:min-h-0 mobile:grow">
      <section aria-label="Conversation" className="flex min-w-0 flex-[999_1_520px] flex-col border-r border-line mobile:border-r-0">
        {mobile ? (
          <AppBar
            title={title}
            subtitle="Coach"
            leading={
              <IconButton aria-label="Threads" aria-expanded={threadsOpen} onClick={() => setThreadsOpen(true)}>
                <MenuIcon />
              </IconButton>
            }
            actions={
              <>
                <IconButton aria-label={memoryLabel} aria-haspopup="dialog" className="relative" onClick={() => setMemoryOpen(true)}>
                  <BookmarkIcon size={20} />
                  {memory.toReview > 0 && <span aria-hidden className="absolute top-2.5 right-2 h-2 w-2 rounded-full bg-[#E8A33D]" />}
                </IconButton>
                <IconButton aria-label="New chat" disabled={streaming} onClick={newChat}>
                  <ComposeIcon />
                </IconButton>
              </>
            }
          >
            <TodayStrip onAsk={(p) => void send(p)} />
            <ConnectNudgeRow />
          </AppBar>
        ) : (
        <div className="sticky top-0 z-20 bg-bg">
        <PageHeader
          title={title}
          subtitle={view ? `Started ${new Date(view.thread.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Ask anything about your training'}
        >
          <Button aria-label={memoryLabel} aria-haspopup="dialog" onClick={() => setMemoryOpen(true)}>
            <BookmarkIcon size={16} />
            Memory
            <span aria-hidden className="flex h-5 min-w-5 items-center justify-center rounded-full bg-hover px-1.5 font-mono text-[11px] font-semibold text-[#3A414D]">
              {memory.notes.length}
            </span>
            {memory.toReview > 0 && <span aria-hidden className="h-2 w-2 rounded-full bg-[#E8A33D]" />}
          </Button>
          <ThreadsMenu current={threadId} onPick={(id) => void navigate({ to: '/', search: { t: id } })} />
          <Button variant="primary" disabled={streaming} onClick={newChat}>
            New chat
          </Button>
        </PageHeader>
        <ConnectNudgeRow className="border-b border-line @min-[940px]:hidden" />
        </div>
        )}
        {threadsOpen && (
          <Sheet title="Threads" onClose={() => setThreadsOpen(false)}>
            <div className="-mx-2 flex flex-col">
              <ThreadList
                current={threadId}
                onPick={(id) => {
                  setThreadsOpen(false);
                  void navigate({ to: '/', search: { t: id } });
                }}
              />
            </div>
          </Sheet>
        )}

        <CoachFoodContext value={foodActions}>
        <RequestChangesContext value={requestChanges}>
        <div ref={scroll.conversationRef} className="mx-auto box-border flex w-full max-w-[860px] grow flex-col gap-[22px] p-7 mobile:gap-4 mobile:p-4">
          {messages.length === 0 && !live && (
            <div className="flex flex-col items-start gap-3 text-muted">
              <CoachAvatar />
              <p className="m-0">
                Ask me to pull your recent rides, plan your week around races, or build a workout. I can see your
                profile, goals, memory, workout library and calendar.
              </p>
              {!threadId && !isNew && wentQuiet && resume && (
                <button type="button" className="min-h-9 text-left text-accent-ink underline" onClick={() => void navigate({ to: '/', search: { t: resume.id } })}>
                  Continue: {resume.title} · {new Date(resume.lastMessageAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {resume.openCards ? ` · ${resume.openCards === 1 ? '1 card' : `${resume.openCards} cards`} waiting` : ''}
                </button>
              )}
            </div>
          )}
          {messages.map((m) => (
            <Fragment key={m.id}>
              {view?.contextBreaks.includes(m.id) && <ContextBreak reset={view.contextResets.includes(m.id)} />}
              <MessageRow message={m} view={view} cards={cards} />
            </Fragment>
          ))}
          {showLive && live && (
            <>
              {!retryingLast && (
                <div data-user-row className="max-w-[78%] self-end rounded-[16px_16px_4px_16px] bg-user-bubble px-4 py-3.5 whitespace-pre-wrap mobile:max-w-[85%] mobile:py-3">
                  {live.userText}
                </div>
              )}
              <div className="flex items-start gap-3">
                <CoachAvatar />
                <div className="coach-live flex min-w-0 flex-auto flex-col gap-3.5">
                  <AssistantBlocks blocks={live.blocks} threadId={threadId ?? ''} cards={cards} live />
                  {live.error && <TurnError error={live.error} onRetry={() => void send(live.userText)} />}
                </div>
              </div>
            </>
          )}
          {lateError && live && <TurnError error={lateError} onRetry={() => void send(live.userText)} />}
          {refused && !blocked && <TurnError error={refused} onRetry={() => {}} />}
          <div ref={scroll.endRef} className="h-px" aria-hidden />
        </div>
        </RequestChangesContext>
        </CoachFoodContext>

        {/* Pinned above the tab bar on mobile. */}
        <div ref={scroll.dockRef} className="sticky bottom-0 mx-auto box-border flex w-full max-w-[860px] flex-col gap-2.5 bg-bg px-7 pt-2 pb-6 mobile:bottom-[calc(64px+env(safe-area-inset-bottom))] mobile:gap-2 mobile:border-t mobile:border-line mobile:px-3 mobile:pb-2.5">
          {scroll.showLatest && (
            <button
              type="button"
              onClick={scroll.toLatest}
              className="absolute -top-11 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-medium whitespace-nowrap text-ink shadow-sm"
            >
              <span aria-hidden>↓</span> Latest
            </button>
          )}
          {threadId && view?.contextLong && !blocked && !streaming && <LongChatNotice threadId={threadId} onNewChat={newChat} />}
          {blocked ? (
            <CoachLocked refusal={blocked} />
          ) : (
            <>
              {isFood && <FoodStrip slot={foodSlot} date={foodDate} today={today} onChange={(slot, date) => setFoodPick({ slot, date })} />}
              <div className="flex flex-col gap-2 rounded-2xl border border-[#CDD2DA] bg-surface pt-3 pr-3 pb-2.5 pl-4 mobile:pt-2.5 mobile:pr-2 mobile:pb-2 mobile:pl-3.5">
                <label htmlFor="msg" className="sr-only">
                  Message your coach
                </label>
                <textarea
                  ref={inputRef}
                  id="msg"
                  rows={mobile ? 1 : 2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={mobile ? 'Message your coach' : "Ask your coach — e.g. I'm racing Wednesday after all, adjust the rest of the week"}
                  className="w-full resize-none border-0 bg-transparent py-0.5 text-ink outline-none"
                />
                {/* The status takes the buttons' place during a turn, when Send is off anyway, so the dock keeps its height (#84, #85). */}
                <div className="flex min-h-10 items-center justify-between gap-2 mobile:min-h-[44px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {streaming && live ? (
                      <CoachWorking turn={live} />
                    ) : (
                      <>
                        <SuggestionsMenu prompts={suggestions} onPick={fillDraft} />
                        {buildModel && (
                          <button
                            type="button"
                            aria-pressed={forBuild}
                            title={coachCopy.thinkDeeperHint}
                            onClick={() => setForBuild(!forBuild)}
                            className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap ${
                              forBuild ? 'border-accent-ring bg-accent-tint-2 text-[#2B3A0A]' : 'border-line bg-surface text-[#3A414D]'
                            }`}
                          >
                            <BulbIcon />
                            Think deeper
                          </button>
                        )}
                        {forBuild && <span className="text-xs text-muted">{coachCopy.thinkDeeperHint}</span>}
                      </>
                    )}
                  </div>
                  {streaming ? (
                    <Button variant="ghost" className="h-10 flex-none" onClick={() => abortTurn(threadId)}>
                      Stop
                    </Button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Send"
                      disabled={!draft.trim()}
                      onClick={() => void send(draft)}
                      className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border-0 bg-accent text-on-accent mobile:rounded-full"
                    >
                      {mobile ? <ArrowUpIcon /> : <SendIcon />}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {CoachNotice && <CoachNotice />}
        </div>
      </section>
      {memoryOpen && <MemoryPanel today={today} onClose={() => setMemoryOpen(false)} />}
      <CoachFoodContext value={foodActions}>
      {recipe ? (
        <RecipePane
          key={recipe}
          draftId={recipe}
          initial={cards.recipeDrafts.get(recipe)}
          slot={foodSlot}
          date={foodDate}
          today={today}
          mobile={mobile}
          onClose={closeRecipe}
        />
      ) : writingRecipe ? (
        <RecipePaneSkeleton />
      ) : ideasId ? (
        <IdeaDetailsPane
          ideasId={ideasId}
          index={Number(ideaIndex)}
          initial={cards.mealIdeas.get(ideasId)}
          today={today}
          mobile={mobile}
          onIndex={(i) => openIdea(`${ideasId}.${i}`)}
          onMake={closeIdea}
          onClose={closeIdea}
        />
      ) : (
        !mobile && <RightRail onAsk={(p) => void send(p)} onOpenMemory={() => setMemoryOpen(true)} />
      )}
      </CoachFoodContext>
      {flows.element}
    </div>
  );
}
