import type { SVGProps } from 'react';
import {
  ViewColumnsIcon,
  QueueListIcon,
  BookOpenIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  DocumentTextIcon,
  PlusIcon,
  DocumentIcon,
  FolderIcon as HeroFolderIcon,
  ChevronRightIcon,
  ArrowLeftIcon as HeroArrowLeftIcon,
  InformationCircleIcon,
  SunIcon as HeroSunIcon,
  MoonIcon as HeroMoonIcon,
  XMarkIcon,
  PencilSquareIcon,
  CalendarIcon as HeroCalendarIcon,
  Cog6ToothIcon,
  TicketIcon as HeroTicketIcon,
  ExclamationTriangleIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  TrashIcon as HeroTrashIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

/* Heroicons (outline) under the app's semantic names. Each wrapper bakes in a
   default size matching the icon's primary use, since Heroicons render an SVG
   with no intrinsic width/height; explicit CSS `svg` px rules still override at
   sites that set them (nav 17px, .btn 15px, .tree-item 15px, board arrow 18px).
   Incoming props spread last so className/style/transform from call sites win. */

type HeroIcon = typeof PlusIcon;

const make = (Hero: HeroIcon, size: number) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return <Hero width={size} height={size} aria-hidden {...props} />;
  };

/** Settings: the configuration home. */
export const SettingsIcon = make(Cog6ToothIcon, 17);

/** Problems: the validation warning triangle. */
export const ProblemsIcon = make(ExclamationTriangleIcon, 17);

/** New folder / new file: the tree's create affordances. */
export const NewFolderIcon = make(FolderPlusIcon, 15);
export const NewFileIcon = make(DocumentPlusIcon, 15);

/** Trash: the tree's delete affordance. */
export const TrashIcon = make(HeroTrashIcon, 15);

/** Lock: a built-in item that ships with every project and cannot be edited. */
export const LockIcon = make(LockClosedIcon, 14);

/** Board: the columns of work. */
export const BoardIcon = make(ViewColumnsIcon, 17);

/** List: stacked rows. */
export const ListIcon = make(QueueListIcon, 17);

/** Documentation: an open book. */
export const DocsIcon = make(BookOpenIcon, 17);

/** Search: the lens. */
export const SearchIcon = make(MagnifyingGlassIcon, 17);

/** Sessions: the loop in time. */
export const SessionsIcon = make(ClockIcon, 17);

/** Digest: lines of the record. */
export const DigestIcon = make(DocumentTextIcon, 15);

/** Add: a plain plus. */
export const AddIcon = make(PlusIcon, 15);

/** Edit: a pencil over a page. */
export const EditIcon = make(PencilSquareIcon, 15);

/** File: a single card. */
export const FileIcon = make(DocumentIcon, 15);

/** Ticket: the work item, for the reference toolbar. */
export const TicketIcon = make(HeroTicketIcon, 15);

/** Folder: the drawer. */
export const FolderIcon = make(HeroFolderIcon, 15);

/** Caret: the disclosure chevron, rotated by CSS per context. */
export const CaretIcon = make(ChevronRightIcon, 14);

/** Back: a left arrow. */
export const ArrowLeftIcon = make(HeroArrowLeftIcon, 15);

/** Info: project details behind a quiet glyph. */
export const InfoIcon = make(InformationCircleIcon, 16);

/** Theme: the lit and unlit sky, for the appearance toggle. */
export const SunIcon = make(HeroSunIcon, 15);
export const MoonIcon = make(HeroMoonIcon, 15);

/** Close: dismiss a modal. */
export const CloseIcon = make(XMarkIcon, 16);

/** Date: the datepicker trigger. */
export const CalendarIcon = make(HeroCalendarIcon, 15);

/** Graph: connected documents, drawn as three linked nodes. */
export function GraphIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M6.5 7.3 11 15.5M17 8.7 12.3 16" />
      <circle cx="5" cy="6" r="2.3" />
      <circle cx="18" cy="7.5" r="2.3" />
      <circle cx="11.5" cy="17.5" r="2.3" />
    </svg>
  );
}
