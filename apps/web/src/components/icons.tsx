import type { SVGProps } from 'react';

/** Stroke icons. */
const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

type P = { size?: number } & SVGProps<SVGSVGElement>;

export const LogoIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.4} {...p}>
    <path d="M3 17l5-6 4 3 4-7 5 10" />
  </svg>
);
export const ChatIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </svg>
);
export const CalendarIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const CalendarAddIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M12 13v5M9.5 15.5h5" />
  </svg>
);
export const BarsIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
  </svg>
);
export const TargetIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);
export const PulseIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 12h4l3-8 4 16 3-8h2" />
  </svg>
);
export const ChevronDown = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const ChevronLeft = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const ChevronRight = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const PlusIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const XIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const CheckIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={3} {...p}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
export const SendIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const PencilIcon = ({ size = 15, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);
export const TrashIcon = ({ size = 15, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const FolderIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const KeyIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M17 6l3 3" />
  </svg>
);
export const MemoryIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3a6 6 0 0 0-6 6c0 2.2 1.2 3.6 2 4.5V17h8v-3.5c.8-.9 2-2.3 2-4.5a6 6 0 0 0-6-6zM9 21h6" />
  </svg>
);
export const TrendUpIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.6} {...p}>
    <path d="M4 17l6-6 4 4 6-8M15 7h5v5" />
  </svg>
);
export const TrendDownIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.6} {...p}>
    <path d="M4 7l6 6 4-4 6 8M15 17h5v-5" />
  </svg>
);
export const WarningIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M12 3l9.5 17h-19zM12 10v4M12 17.5v.5" />
  </svg>
);
export const LockIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const CheckCircleIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.4} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);
export const MenuIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const SearchIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const MoreIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none" {...p}>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const ArrowUpIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const ComposeIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
export const FlagIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h12l-2.5 4L17 12H5" />
  </svg>
);
export const ExternalIcon = ({ size = 17, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const DownloadIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />
  </svg>
);
export const FiltersIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);
/** Filled green check for completed sessions. */
export const DoneIcon = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#15803D" aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
/** Fork and knife — the Food nav item. */
export const ForkKnifeIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3" />
    <path d="M17 21V3c-2 1.5-3 4-3 7s1 4 3 4" />
  </svg>
);
export const CameraIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 8l2-3h12l2 3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const BarcodeIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20 6v12" />
  </svg>
);
export const MicIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
/** AI mode in the Food log bar. */
export const SparkleIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.7 1.9 1.8.6-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.6z" />
  </svg>
);
export const LibraryIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="4" y="4" width="4" height="16" rx="1" />
    <rect x="10" y="4" width="4" height="16" rx="1" />
    <path d="M16.5 5.5l3-1 3 14.5-3 1z" />
  </svg>
);
export const ShareIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3v12" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);
export const ExpandIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </svg>
);
export const ClockIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
