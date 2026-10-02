/**
 * Where the media store keeps each thing under its root (REQ-STOR-099).
 *
 *   <root>/<xy>/<content id>        an object's bytes
 *   <root>/<xy>/<content id>.seal   its seal (`store-records.ts`)
 *   <root>/incoming/<token>         bytes being received, before their
 *                                   identity is known
 *   <root>/incoming/<token>.intent  the object a change is working on
 *
 * `<xy>` is the first two hexadecimal digits of the identifier's digest. The
 * tree lists a directory whole, so a flat directory of every object would make
 * each listing as large as the store; 256 shards bound a listing to a fraction
 * of it, and since each shard is a prefix of the identifiers inside it, walking
 * the shards in order walks the objects in identifier order. `incoming` is not
 * two hexadecimal digits, so it can never be taken for a shard.
 */

import {
  isContentId,
  isTreePath,
  isTreeSegment,
  type ContentId,
} from '@audiogubbins/project-format';

const SHARD = /^[0-9a-f]{2}$/u;
const SEAL_SUFFIX = '.seal';
const INTENT_SUFFIX = '.intent';

/** The paths of one store's things, under the root it was given. */
export class MediaLayout {
  /** The directory the shards are listed from. */
  readonly root: string;

  readonly incoming: string;
  private readonly prefix: string;

  constructor(root: string) {
    if (!isTreePath(root)) throw new Error('A media store is rooted at a valid tree path.');
    this.root = root;
    this.prefix = root === '' ? '' : `${root}/`;
    this.incoming = `${this.prefix}incoming`;
  }

  shard(name: string): string {
    return `${this.prefix}${name}`;
  }

  object(id: ContentId): string {
    return `${this.prefix}${shardOf(id)}/${id}`;
  }

  seal(id: ContentId): string {
    return sealNameOf(this.object(id));
  }

  /** Where bytes arriving under a token are received. */
  received(token: string): string {
    return `${this.incoming}/${checkedToken(token)}`;
  }

  /** Where the intent of a change under a token is written. */
  intent(token: string): string {
    return `${this.incoming}/${checkedToken(token)}${INTENT_SUFFIX}`;
  }
}

/** Whether a name in the root is a shard. */
export function isShardName(name: string): boolean {
  return SHARD.test(name);
}

/** Whether a name in `incoming` is an intent. */
export function isIntentName(name: string): boolean {
  return name.endsWith(INTENT_SUFFIX);
}

/** Whether a name in a shard is an object's, rather than a seal's. */
export function isObjectName(name: string): boolean {
  return isContentId(name);
}

/** The name of the seal beside an object of this name. */
export function sealNameOf(objectName: string): string {
  return `${objectName}${SEAL_SUFFIX}`;
}

function shardOf(id: ContentId): string {
  // After the `c1-` prefix.
  return id.slice(3, 5);
}

/**
 * A token from the injected token source, refused as a programmer error where
 * it could not name a file with its intent suffix added.
 */
function checkedToken(token: string): string {
  if (!isTreeSegment(`${token}${INTENT_SUFFIX}`)) {
    throw new Error('A media store token is a tree segment short enough to take a suffix.');
  }
  return token;
}
