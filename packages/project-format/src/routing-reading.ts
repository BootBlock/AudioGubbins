/**
 * Reading a project's routing from its document: tracks, buses and where each
 * sends its output (REQ-STOR-026, REQ-EXEC-136.12).
 *
 * Every send must name a bus the project has, and following the sends from any
 * bus must reach the main output. A cycle is refused rather than broken,
 * because where a mixer broke it would decide what the project sounds like.
 */

import {
  MAIN_OUTPUT,
  routeToBus,
  routingPathToOutput,
  type Bus,
  type BusId,
  type EffectChain,
  type EffectChainId,
  type RoutingTarget,
  type Track,
} from '@audiogubbins/domain';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  entitiesOf,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { asBoolean, asId, oneOfConverter } from './scalar-reading.js';
import {
  MAXIMUM_ENTITIES,
  asChannelLayout,
  asGain,
  asKey,
  asName,
  asPan,
} from './value-reading.js';

const TRACK_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'displayName',
  'channelLayout',
  'gain',
  'pan',
  'muted',
  'soloed',
  'output',
  'effectChainId',
  'paletteKey',
]);
const BUS_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'displayName',
  'channelLayout',
  'gain',
  'muted',
  'output',
  'effectChainId',
]);
const MAIN_OUTPUT_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const BUS_TARGET_MEMBERS: ReadonlySet<string> = new Set(['kind', 'busId']);

const asTargetKind = oneOfConverter(['main-output', 'bus'] as const);

/** Reads where a track or bus sends its output. */
const asRoutingTarget: Converter<RoutingTarget> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const kind = required(reading, object, at, 'kind', asTargetKind);
  if (kind === 'main-output') {
    checkMembers(reading, object, at, MAIN_OUTPUT_MEMBERS);
    return MAIN_OUTPUT;
  }
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, BUS_TARGET_MEMBERS);
  const busId = required(reading, object, at, 'busId', asId<'BusId'>);
  return busId === undefined ? undefined : routeToBus(busId);
};

/** Refuses a chain reference the project cannot resolve. */
function checkChain(
  reading: Reading,
  chainId: EffectChainId | undefined,
  chains: ReadonlyMap<EffectChainId, EffectChain> | undefined,
  at: string,
): void {
  if (chainId !== undefined && chains !== undefined && !chains.has(chainId)) {
    reading.refuse(
      'project.unknown-effect-chain',
      'The effect chain named is not in the project.',
      pathOf(at, 'effectChainId'),
    );
  }
}

/** A converter reading one track, checked against the buses and chains. */
export function trackConverter(
  buses: ReadonlyMap<BusId, Bus> | undefined,
  chains: ReadonlyMap<EffectChainId, EffectChain> | undefined,
): Converter<Track> {
  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, TRACK_MEMBERS);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);

    const id = required(reading, object, at, 'id', asId<'TrackId'>);
    const displayName = required(reading, object, at, 'displayName', asName);
    const channelLayout = required(reading, object, at, 'channelLayout', asChannelLayout);
    const gain = required(reading, object, at, 'gain', asGain);
    const pan = required(reading, object, at, 'pan', asPan);
    const muted = required(reading, object, at, 'muted', asBoolean);
    const soloed = required(reading, object, at, 'soloed', asBoolean);
    const output = required(reading, object, at, 'output', asRoutingTarget);
    const effectChainId = optional(reading, object, at, 'effectChainId', asId<'EffectChainId'>);
    const paletteKey = optional(reading, object, at, 'paletteKey', asKey);

    checkChain(reading, effectChainId, chains, at);
    if (output?.kind === 'bus' && buses !== undefined && !buses.has(output.busId)) {
      reading.refuse(
        'project.unknown-bus',
        'The track sends its output to a bus the project does not have.',
        pathOf(pathOf(at, 'output'), 'busId'),
      );
    }

    if (
      id === undefined ||
      displayName === undefined ||
      channelLayout === undefined ||
      gain === undefined ||
      pan === undefined ||
      muted === undefined ||
      soloed === undefined ||
      output === undefined
    ) {
      return undefined;
    }
    return {
      id,
      displayName,
      channelLayout,
      gain,
      pan,
      muted,
      soloed,
      output,
      ...(effectChainId === undefined ? {} : { effectChainId }),
      ...(paletteKey === undefined ? {} : { paletteKey }),
    };
  };
}

/**
 * Reads the buses, then checks their routing once all are known: each bus sent
 * to must exist, and only then can a cycle be looked for.
 */
export function readBuses(
  reading: Reading,
  object: JsonObject,
  at: string,
  chains: ReadonlyMap<EffectChainId, EffectChain> | undefined,
): ReadonlyMap<BusId, Bus> | undefined {
  const positions = new Map<BusId, number>();
  const asBus: Converter<Bus> = (inner, value, parent, key) => {
    const bus = readBus(inner, value, parent, key, chains);
    if (bus !== undefined && typeof key === 'number' && !positions.has(bus.id)) {
      positions.set(bus.id, key);
    }
    return bus;
  };
  const buses = entitiesOf(reading, object, at, 'buses', MAXIMUM_ENTITIES, asBus);
  if (buses === undefined) return undefined;

  const listAt = pathOf(at, 'buses');
  let resolved = true;
  for (const bus of buses.values()) {
    if (bus.output?.kind === 'bus' && !buses.has(bus.output.busId)) {
      resolved = false;
      const outputAt = pathOf(pathOf(listAt, positions.get(bus.id) ?? 0), 'output');
      reading.refuse(
        'project.unknown-bus',
        'The bus sends its output to a bus the project does not have.',
        pathOf(outputAt, 'busId'),
      );
    }
  }
  if (resolved) {
    for (const bus of buses.values()) {
      if (routingPathToOutput(routeToBus(bus.id), buses) === undefined) {
        const outputAt = pathOf(pathOf(listAt, positions.get(bus.id) ?? 0), 'output');
        reading.refuse(
          'project.routing-cycle',
          'Following the bus sends from here never reaches the main output.',
          outputAt,
        );
      }
    }
  }
  return buses;
}

/** Reads one bus, checked against the chains. */
function readBus(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  chains: ReadonlyMap<EffectChainId, EffectChain> | undefined,
): Bus | undefined {
  const object = objectOf(reading, value, parent, key, BUS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'BusId'>);
  const displayName = required(reading, object, at, 'displayName', asName);
  const channelLayout = required(reading, object, at, 'channelLayout', asChannelLayout);
  const gain = required(reading, object, at, 'gain', asGain);
  const muted = required(reading, object, at, 'muted', asBoolean);
  const output = optional(reading, object, at, 'output', asRoutingTarget);
  const effectChainId = optional(reading, object, at, 'effectChainId', asId<'EffectChainId'>);
  checkChain(reading, effectChainId, chains, at);

  if (
    id === undefined ||
    displayName === undefined ||
    channelLayout === undefined ||
    gain === undefined ||
    muted === undefined
  ) {
    return undefined;
  }
  return {
    id,
    displayName,
    channelLayout,
    gain,
    muted,
    ...(output === undefined ? {} : { output }),
    ...(effectChainId === undefined ? {} : { effectChainId }),
  };
}
