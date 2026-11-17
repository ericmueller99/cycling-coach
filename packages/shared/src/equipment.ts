import { z } from 'zod';

/**
 * The athlete's bikes, which rides were on which, and how far a waxed chain has gone since its last
 * wax (DECISIONS #114). Kept in this app: intervals.icu's own gear is neither read nor written.
 */

/** A local wall-clock time, `YYYY-MM-DDTHH:mm`, in the athlete's timezone, as ride starts are. */
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:mm');
export type LocalDateTime = z.infer<typeof localDateTimeSchema>;

/** Which rides a bike takes by default: trainer and virtual rides, or rides outside. */
export const rideKinds = ['indoor', 'outdoor'] as const;
export const rideKindSchema = z.enum(rideKinds);
export type RideKind = z.infer<typeof rideKindSchema>;

export const chainTypes = ['waxed', 'lubed'] as const;
export type ChainType = (typeof chainTypes)[number];
export const CHAIN_LABEL: Record<ChainType, string> = { waxed: 'Waxed', lubed: 'Lubed' };

export const REWAX_KM_MIN = 50;
export const REWAX_KM_MAX = 5000;
/** What the form suggests for a new waxed chain. */
export const REWAX_KM_SUGGESTED = 300;

/** A lubed chain is a type only, for now: nothing is tracked on it. */
export const chainSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('waxed'),
    rewaxKm: z.number().int().min(REWAX_KM_MIN).max(REWAX_KM_MAX),
    /** Rides that start after this count toward the next wax. */
    lastWaxedAt: localDateTimeSchema,
  }),
  z.object({ type: z.literal('lubed') }),
]);
export type Chain = z.infer<typeof chainSchema>;

/** Without defaults, so the patch can be built from them (rule 1b). */
const bikeFields = z.object({
  name: z.string().trim().min(1).max(60),
  /** At most one bike per kind: setting it here takes it from any other bike. */
  defaultFor: rideKindSchema.optional(),
  chain: chainSchema,
  notes: z.string().max(500).optional(),
});

export const bikeInputSchema = bikeFields;
export type BikeInput = z.infer<typeof bikeInputSchema>;

export const bikePatchSchema = bikeFields.partial().extend({
  /** Fields to remove. A field both set and unset keeps the set value. */
  unset: z.array(z.enum(['defaultFor', 'notes'])).optional(),
});
export type BikePatch = z.infer<typeof bikePatchSchema>;

/** One "Mark re-waxed": when, and how far the chain had gone. */
export interface WaxRecord {
  at: LocalDateTime;
  km: number;
}

export type Bike = BikeInput & { id: string; waxes: WaxRecord[] };

/** Where a waxed chain is: distance since its last wax against the interval. */
export interface ChainWear {
  km: number;
  rides: number;
  /** `km / rewaxKm`. */
  share: number;
  due: boolean;
}

/** A bike with its totals. `chain` wear only on a waxed chain. */
export type BikeStatus = Bike & { km: number; rides: number; wear?: ChainWear | undefined };

export interface EquipmentPayload {
  bikes: BikeStatus[];
  /** Cycling rides of the last 30 days with no bike, so the rider can see what isn't counted. */
  unassigned: { rides: number; km: number };
}

/** A waxed chain past its interval, for the Coach rail's alert. */
export interface ChainDue {
  bikeId: string;
  name: string;
  km: number;
  rewaxKm: number;
  lastWaxedAt: LocalDateTime;
}

export const waxedInputSchema = z.object({ at: localDateTimeSchema.optional() });
export type WaxedInput = z.infer<typeof waxedInputSchema>;

/** `null` says "no bike" (a rental, a friend's), so a default never takes the ride. */
export const rideBikeInputSchema = z.object({ bikeId: z.string().min(1).nullable() });
export type RideBikeInput = z.infer<typeof rideBikeInputSchema>;
