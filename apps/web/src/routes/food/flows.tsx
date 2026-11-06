import type { Food, FoodLibrary, FoodLogEntry, IsoDate } from '@cycling-coach/shared';
import { useState, type ReactNode } from 'react';
import { shouldShowFoodIntro } from '../../lib/foodIntro';
import { useMarkFoodIntroSeen } from '../../lib/foodQueries';
import { BarcodeDialog } from './BarcodeDialog';
import { EntryDialog } from './EntryDialog';
import { FoodIntro } from './FoodIntro';
import { draftFromFood, draftFromReading, emptyDraft, FoodFormDialog, type FoodDraft } from './FoodForm';
import { LogFoodDialog } from './LogFoodDialog';
import { PhotoDialog } from './PhotoDialog';
import { ReadBanner } from './ReadBanner';
import { StaplesDialog } from './StaplesDialog';
import { WordsDialog } from './WordsDialog';

/**
 * The food dialogs and how they hand over to each other: "Enter manually" from Log food opens the
 * food form; "Save & log" goes straight back to Log food with the new food picked; a scanned
 * barcode that's already one of the user's foods opens it for logging. One flow at a time, so Esc and
 * the backdrop only ever close the top one.
 *
 * The first attempt to log shows the food intro in that flow's place, and the flow carries on when
 * the intro ends (DECISIONS #88). Every way to log comes through here.
 */
export type Flow =
  | {
      kind: 'log';
      slot: string;
      preselect?: { kind: 'food' | 'recipe' | 'meal'; id: string } | undefined;
      /** Opened from the log bar's "Search staples for 'q'". */
      query?: string | undefined;
      staples?: boolean | undefined;
      /** Open in AI mode with this phrase. */
      phrase?: string | undefined;
    }
  | { kind: 'newFood'; draft: FoodDraft; slot: string; title?: string | undefined; flags?: ReadonlySet<string> | undefined; banner?: ReactNode }
  | { kind: 'editFood'; food: Food }
  | { kind: 'staples'; query: string; slot: string }
  | { kind: 'photo'; slot: string; barcode?: string | undefined }
  /** `then`: what a known barcode opens — logging it, or editing it (My foods). */
  | { kind: 'barcode'; slot: string; then: 'log' | 'edit' }
  | { kind: 'words'; phrase: string; slot: string }
  | { kind: 'entry'; entry: FoodLogEntry };

const offBanner = (
  <div className="rounded-[12px] border border-[#F3D58A] bg-[#FFF8E6] p-3 text-[13px] text-[#7A4B00]">
    From Open Food Facts (community data). Check the values against the package before saving — it's yours to fix now.
  </div>
);

export function useFoodFlows({ lib, date, dateLabel, defaultSlot }: { lib: FoodLibrary | undefined; date: IsoDate; dateLabel: string; defaultSlot: string }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const close = () => setFlow(null);
  const markIntroSeen = useMarkFoodIntroSeen();
  const [replaying, setReplaying] = useState(false);
  /** Over for this page: a library refetch already on its way could still say it's unseen. */
  const [introDone, setIntroDone] = useState(false);

  const afterSave = (slot: string) => (food: Food, log: boolean) => setFlow(log ? { kind: 'log', slot, preselect: { kind: 'food', id: food.id } } : null);

  const logging = flow?.kind === 'log' || flow?.kind === 'words';
  const showIntro = !!lib && (replaying || (logging && !introDone && shouldShowFoodIntro(lib)));
  const endIntro = (startLogging: boolean) => {
    setReplaying(false);
    setIntroDone(true);
    markIntroSeen.mutate();
    if (startLogging && !logging) setFlow({ kind: 'log', slot: defaultSlot });
  };

  let element: ReactNode = null;
  if (lib && showIntro) {
    element = <FoodIntro lib={lib} onEnd={endIntro} />;
  } else if (lib && flow) {
    switch (flow.kind) {
      case 'log':
        element = (
          <LogFoodDialog
            lib={lib}
            date={date}
            dateLabel={dateLabel}
            slot={flow.slot}
            preselect={flow.preselect}
            initialQuery={flow.query}
            includeStaples={flow.staples}
            initialMode={flow.phrase != null ? 'ai' : undefined}
            initialPhrase={flow.phrase}
            onClose={close}
            addNew={{
              manual: (name) => setFlow({ kind: 'newFood', draft: emptyDraft(name), slot: flow.slot }),
              photo: () => setFlow({ kind: 'photo', slot: flow.slot }),
              barcode: () => setFlow({ kind: 'barcode', slot: flow.slot, then: 'log' }),
            }}
          />
        );
        break;
      case 'newFood':
        element = <FoodFormDialog title={flow.title ?? 'New food'} initial={flow.draft} flags={flow.flags} banner={flow.banner} onClose={close} onSaved={afterSave(flow.slot)} />;
        break;
      case 'editFood':
        element = <FoodFormDialog title="Edit food" initial={draftFromFood(flow.food)} editing={flow.food} onClose={close} onSaved={close} saveAndLog={false} />;
        break;
      case 'staples':
        element = <StaplesDialog initialQuery={flow.query} onClose={close} onSaved={afterSave(flow.slot)} />;
        break;
      case 'photo':
        element = (
          <PhotoDialog
            barcode={flow.barcode}
            onClose={close}
            onRead={({ reading, images, previews }) => {
              const { draft, flags, read } = draftFromReading(reading, reading.imageType, images, flow.barcode);
              setFlow({
                kind: 'newFood',
                slot: flow.slot,
                title: 'Check and save',
                draft,
                flags,
                banner: <ReadBanner previews={previews} read={read} check={[...flags].filter((f) => f !== 'barcode').length} note={reading.note} />,
              });
            }}
          />
        );
        break;
      case 'barcode':
        element = (
          <BarcodeDialog
            lib={lib}
            today={date}
            onClose={close}
            onFound={(food) => setFlow(flow.then === 'log' ? { kind: 'log', slot: flow.slot, preselect: { kind: 'food', id: food.id } } : { kind: 'editFood', food })}
            onReviewOff={(product) => {
              const { imageUrl: _img, ...food } = product;
              setFlow({ kind: 'newFood', slot: flow.slot, title: 'Check and save', draft: draftFromFood(food), banner: offBanner });
            }}
            onPhoto={(barcode) => setFlow({ kind: 'photo', slot: flow.slot, barcode })}
            onManual={(barcode) => setFlow({ kind: 'newFood', slot: flow.slot, draft: { ...emptyDraft(), barcodes: barcode } })}
          />
        );
        break;
      case 'words':
        element = (
          <WordsDialog
            lib={lib}
            phrase={flow.phrase}
            date={date}
            slot={flow.slot}
            onClose={close}
            onEditManually={(slot) => setFlow({ kind: 'log', slot })}
            addNew={{ photo: () => setFlow({ kind: 'photo', slot: flow.slot }), manual: (name) => setFlow({ kind: 'newFood', draft: emptyDraft(name), slot: flow.slot }) }}
          />
        );
        break;
      case 'entry':
        element = <EntryDialog entry={flow.entry} lib={lib} onClose={close} />;
        break;
    }
  }

  return {
    flow,
    setFlow,
    element,
    logFood: (slot = defaultSlot) => setFlow({ kind: 'log', slot }),
    newFood: (name = '', slot = defaultSlot) => setFlow({ kind: 'newFood', draft: emptyDraft(name), slot }),
    staples: (query = '', slot = defaultSlot) => setFlow({ kind: 'staples', query, slot }),
    photo: (slot = defaultSlot) => setFlow({ kind: 'photo', slot }),
    barcode: (then: 'log' | 'edit', slot = defaultSlot) => setFlow({ kind: 'barcode', slot, then }),
    words: (phrase: string, slot = defaultSlot) => setFlow({ kind: 'words', phrase, slot }),
    replayIntro: () => setReplaying(true),
  };
}
