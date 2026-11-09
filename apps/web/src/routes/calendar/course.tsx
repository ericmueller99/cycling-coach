import { climbMarkers, climbTimeRange, courseSummary, formatMeters, formatTimeRange, profileBars } from '@cycling-coach/core';
import type { CalendarEvent, CourseAnalysis } from '@cycling-coach/shared';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { CourseIcon, WarningIcon } from '../../components/icons';
import { ErrorNote } from '../../components/ui';
import { courseError, readGpxFile, type ReadCourse } from '../../lib/course';
import { errorMessage, useCourse, useCourseMutations, useProfile } from '../../lib/queries';

/**
 * An event's course (DECISIONS #99), as design/events-2026-11-07 draws it: grey bars like the workout
 * charts, the climbs darker and the longest darkest, numbered markers above.
 */
const BAR = { road: '#D5D9E0', climb: '#9AA1AD', longest: '#5B6472' };

const barColor = (climb: number, a: CourseAnalysis) => (climb === 0 ? BAR.road : a.climbs.find((c) => c.n === climb)?.longest ? BAR.longest : BAR.climb);

/** Round km marks under the chart: two to four of them, never crowding the end label. */
function axisMarks(km: number): number[] {
  const step = [5, 10, 20, 25, 50, 100, 200, 500].find((s) => km / s <= 4) ?? 1000;
  const out: number[] = [];
  for (let k = step; k < km - step * 0.4; k += step) out.push(k);
  return out;
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-[#F3D58A] bg-[#FFF8E6] px-2.5 py-2 text-[13px] text-[#7A4B00]">
      <WarningIcon size={15} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** The small profile in the Add event panel, about two km a bar. */
export function MiniProfile({ analysis }: { analysis: CourseAnalysis }) {
  const bars = profileBars(analysis, Math.max(40, Math.round(analysis.distanceKm / 2)));
  return (
    <div aria-hidden="true" className="flex h-[60px] items-end border-b border-line">
      {bars.map((b, i) => (
        <div key={i} className="min-w-0 flex-1" style={{ height: `${b.height}%`, background: barColor(b.climb, analysis) }} />
      ))}
    </div>
  );
}

/**
 * The event panel's profile: highest and lowest point, climb markers, bars and a km axis. A Zwift race
 * (DECISIONS #102) labels each marker with its climb's group (the same KOM every lap), drops the markers
 * when there are too many to read, and marks its sprints under the bars.
 */
export function ElevationProfile({
  analysis,
  markerLabel = (n) => String(n),
  maxMarkers = Infinity,
  sprints = [],
}: {
  analysis: CourseAnalysis;
  markerLabel?: (n: number) => string;
  maxMarkers?: number;
  /** Km of each sprint. */
  sprints?: readonly number[];
}) {
  const bars = profileBars(analysis);
  const markers = climbMarkers(analysis);
  const km = analysis.distanceKm;
  const longest = analysis.climbs.find((c) => c.longest);
  const label = `Elevation profile, ${Math.round(km)} km, ${analysis.climbs.length === 1 ? 'one climb' : `${analysis.climbs.length} climbs`}${longest ? `; climb ${longest.n} at km ${Math.round(longest.startKm)} is the longest` : ''}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between font-mono text-[11px] text-muted">
        <span>↑ {formatMeters(analysis.maxM ?? 0)}</span>
        <span>↓ {formatMeters(analysis.minM ?? 0)}</span>
      </div>
      <div aria-hidden="true" className="relative h-5">
        {(markers.length <= maxMarkers ? markers : []).map((m) => (
          <span
            key={m.n}
            className="absolute top-0 flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
            style={{
              left: `calc(${m.leftPct}% - 10px)`,
              border: `1.5px solid ${m.longest ? '#15181E' : '#9AA1AD'}`,
              background: m.longest ? '#15181E' : '#FFFFFF',
              color: m.longest ? '#FFFFFF' : '#15181E',
            }}
          >
            {markerLabel(m.n)}
          </span>
        ))}
      </div>
      <div role="img" aria-label={label} className="flex h-24 items-end border-b border-[#C5CBD4]">
        {bars.map((b, i) => (
          <div key={i} className="min-w-0 flex-1" style={{ height: `${b.height}%`, background: barColor(b.climb, analysis) }} />
        ))}
      </div>
      {sprints.length > 0 && (
        <div aria-hidden="true" className="relative h-4">
          {sprints.map((k, i) => (
            <span
              key={i}
              className="absolute top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border border-[#9AA1AD] bg-surface font-mono text-[9px] font-bold text-ink"
              style={{ left: `calc(${(k / km) * 100}% - 7px)` }}
            >
              S
            </span>
          ))}
        </div>
      )}
      <div aria-hidden="true" className="relative h-4 font-mono text-[11px] text-muted">
        <span className="absolute left-0">0</span>
        {axisMarks(km).map((k) => (
          <span key={k} className="absolute -translate-x-1/2" style={{ left: `${(k / km) * 100}%` }}>
            {k}
          </span>
        ))}
        <span className="absolute right-0">{Math.round(km)} km</span>
      </div>
    </div>
  );
}

/** The climbs, numbered, with this rider's time for each when their FTP is known. */
export function ClimbList({ analysis, ftp, weightKg }: { analysis: CourseAnalysis; ftp: number | undefined; weightKg: number | undefined }) {
  if (!analysis.climbs.length) return <div className="border-t border-divider px-3.5 py-2.5 text-[13px] text-muted">No climbs of 500 m or more at 3% or steeper.</div>;
  return (
    <ol className="m-0 mt-2 flex list-none flex-col p-0">
      {analysis.climbs.map((c) => (
        <li key={c.n} className="flex items-start gap-2.5 border-t border-divider px-3.5 py-2.5" style={{ background: c.longest ? '#F6F7F9' : '#FFFFFF' }}>
          <span
            className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-mono text-[11px] font-semibold"
            style={{ border: `1.5px solid ${c.longest ? '#15181E' : '#9AA1AD'}`, background: c.longest ? '#15181E' : '#FFFFFF', color: c.longest ? '#FFFFFF' : '#15181E' }}
          >
            {c.n}
          </span>
          <span className="flex min-w-0 flex-auto flex-col">
            <span className="font-semibold">
              <span className="font-mono">{c.lengthKm} km</span> at <span className="font-mono">{c.avgPct}%</span>
              {c.longest && <span className="ml-1.5 rounded-[5px] bg-ink px-1.5 align-[1px] text-[10px] leading-[17px] font-bold text-white">Longest</span>}
            </span>
            <span className="font-mono text-xs text-muted">
              km {c.startKm.toFixed(1)} · max {c.maxPct}% · +{formatMeters(c.gainM)}
            </span>
          </span>
          {ftp && weightKg && (
            <span className="flex flex-none flex-col text-right">
              <span className="font-mono font-semibold">{formatTimeRange(climbTimeRange(c, ftp, weightKg))}</span>
              <span className="text-[11px] text-muted">for you</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Reads a GPX on the device. `children` is what to show before a file is picked: the Add panel's
 * drop zone, or the event panel's "Add the course" button. Errors show under it.
 */
function GpxInput({ onRead, children }: { onRead: (r: ReadCourse) => void | Promise<void>; children: (open: () => void, over: boolean) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(file.name);
    try {
      let course: ReadCourse;
      try {
        course = await readGpxFile(file);
      } catch (e) {
        return setError(courseError(e));
      }
      await onRead(course);
    } catch (e) {
      setError(`Couldn’t save the course: ${errorMessage(e)}`);
    } finally {
      setReading(null);
    }
  };
  const drop = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      void read(e.dataTransfer.files[0]);
    },
  };
  return (
    <div className="flex flex-col gap-2" {...drop}>
      <input
        ref={input}
        type="file"
        accept=".gpx,application/gpx+xml"
        hidden
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {reading ? (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" className="animate-spin">
            <circle cx="12" cy="12" r="9" stroke="#E5E8EC" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="#7DA30A" />
          </svg>
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">Reading the course…</span>
            <span className="truncate font-mono text-xs text-muted">{reading}</span>
          </span>
        </div>
      ) : (
        children(() => input.current?.click(), over)
      )}
      {error && <Warning>{error}</Warning>}
    </div>
  );
}

/**
 * The Add and Edit panels' course: a drop zone, then the file with a small profile once one is read.
 * Nothing is uploaded until the event is saved.
 */
export function CoursePicker({
  current,
  onRead,
  onRemove,
  editing = false,
}: {
  current: { fileName?: string | undefined; analysis: CourseAnalysis } | null;
  onRead: (r: ReadCourse) => void;
  onRemove: () => void;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">
        Course <span className="font-normal">· optional</span>
      </span>
      <GpxInput onRead={onRead}>
        {(open, over) =>
          current ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3">
              <div className="flex items-center gap-2">
                <CourseIcon size={16} className="shrink-0 text-accent-ink" />
                <span className="min-w-0 flex-auto truncate font-mono text-xs">{current.fileName ?? 'Course'}</span>
                <button type="button" onClick={open} className="min-h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink">
                  {editing ? 'Replace course' : 'Replace'}
                </button>
                <button type="button" onClick={onRemove} className="min-h-8 rounded-lg border-0 bg-transparent px-2 text-xs font-medium text-muted">
                  {editing ? 'Remove course' : 'Remove'}
                </button>
              </div>
              {current.analysis.ascentM !== null ? (
                <>
                  <MiniProfile analysis={current.analysis} />
                  <div className="font-mono text-xs font-semibold">{courseSummary(current.analysis)}</div>
                </>
              ) : (
                <>
                  <div className="font-mono text-xs font-semibold">{courseSummary(current.analysis)}</div>
                  <Warning>No elevation in this file: we’ll use the distance only.</Warning>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={open}
              className="flex items-start gap-3 rounded-xl border-[1.5px] border-dashed p-3.5 text-left text-ink"
              style={{ borderColor: over ? '#7DA30A' : '#C5CBD4', background: over ? '#F4FADF' : '#FFFFFF' }}
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface">
                <CourseIcon size={18} className="text-accent-ink" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">Add the course (GPX)</span>
                <span className="text-xs text-muted">We’ll fill in what we can. The file stays on your device; only the route is saved.</span>
                <span className="text-xs font-semibold text-accent-ink">Drop a .gpx file here, or choose one</span>
              </span>
            </button>
          )
        }
      </GpxInput>
    </div>
  );
}

/** The event panel's course card, or a drop zone that adds one straight away. */
export function CourseCard({ event }: { event: CalendarEvent }) {
  const course = useCourse(event.id, !!event.courseId);
  const { put } = useCourseMutations();
  const athlete = useProfile().data?.profile;
  const ftp = athlete?.ftpZwift;
  const weightKg = athlete?.weightKg;

  if (!event.courseId || course.data === null) {
    return (
      <GpxInput onRead={async (r) => void (await put.mutateAsync({ id: event.id, input: r.input }))}>
        {(open, over) => (
          <button
            type="button"
            onClick={open}
            disabled={put.isPending}
            className="flex items-center gap-3 rounded-xl border-[1.5px] border-dashed p-4 text-left text-ink"
            style={{ borderColor: over ? '#7DA30A' : '#C5CBD4', background: over ? '#F4FADF' : '#FFFFFF' }}
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-surface-2">
              <CourseIcon size={18} className="text-accent-ink" />
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{put.isPending ? 'Saving the course…' : 'Add the course (GPX) to see its climbs.'}</span>
              <span className="text-xs text-muted">Drop a file here, or choose one</span>
            </span>
          </button>
        )}
      </GpxInput>
    );
  }
  if (course.error) return <ErrorNote>Couldn’t load the course: {errorMessage(course.error)}</ErrorNote>;
  if (!course.data) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-label="Loading the course" />;

  const { analysis, fileName } = course.data;
  return (
    <section aria-labelledby={`course-${event.id}`} className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="flex items-baseline gap-2 px-3.5 pt-3">
        <h3 id={`course-${event.id}`} className="m-0 flex-auto text-[15px]">
          Course
        </h3>
        {fileName && <span className="min-w-0 truncate font-mono text-[11px] text-muted">{fileName}</span>}
      </div>
      {analysis.ascentM === null ? (
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <div className="font-mono text-xs font-semibold">{courseSummary(analysis)}</div>
          <Warning>No elevation in this file, so there are no climbs to show.</Warning>
        </div>
      ) : (
        <>
          <div className="px-3.5 pt-2.5">
            <ElevationProfile analysis={analysis} />
          </div>
          <ClimbList analysis={analysis} ftp={ftp} weightKg={weightKg} />
          <div className="flex flex-col gap-1 border-t border-divider px-3.5 pt-2.5 pb-3">
            {analysis.finishGainM !== null && (
              <div className="text-[13px]">
                Last 20 km: <span className="font-mono font-semibold">+{formatMeters(analysis.finishGainM)}</span>
              </div>
            )}
            {analysis.climbs.length > 0 &&
              (ftp ? (
                <div className="text-xs text-muted">Climb times are estimates from your FTP and weight.</div>
              ) : (
                <div className="text-xs text-muted">
                  <Link to="/athlete/$tab" params={{ tab: 'performance' }} className="font-semibold">
                    Set your FTP
                  </Link>{' '}
                  to see climb times.
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
