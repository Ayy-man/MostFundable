// The glyph table.
//
// The catalog names a glyph and this resolves it, so the catalog stays a data file with no imports
// from the icon set and a test can walk every kind without pulling React in.
//
// The icon is never the only channel. Every row carries its noun in text — as the band's eyebrow, or
// as the screen-reader prefix on a line — so a row still reads correctly with colour and icons
// stripped out, which is the DESIGN.md rule that a status must have a label channel as well as a
// visual one.

import {
  ArrowRightLeft,
  CreditCard,
  FileCheck2,
  Flag,
  Gauge,
  Landmark,
  ListChecks,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";

import type { TimelineGlyph } from "./catalog";

export const TIMELINE_GLYPHS: Readonly<Record<TimelineGlyph, LucideIcon>> = {
  bank: Landmark,
  card: CreditCard,
  chat: MessageSquare,
  doc: FileCheck2,
  flag: Flag,
  gauge: Gauge,
  list: ListChecks,
  person: UserRoundCheck,
  refresh: RefreshCw,
  shield: ShieldCheck,
  stage: ArrowRightLeft,
};
