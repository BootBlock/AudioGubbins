/**
 * Why a running kernel refuses a parameter change.
 *
 * One definition of each refusal, so every node type refuses a parameter it
 * does not have, or a value it cannot take, with the same code a host can act
 * on, however many types there are.
 */

import { failure, FailureKind, fail, type DomainFailureResult } from '@audiogubbins/domain';

/** The refusal of a parameter a node type does not have. */
export function unknownParameter(type: string, name: string): DomainFailureResult {
  return fail(
    failure(
      'node.parameter-unknown',
      FailureKind.Rejected,
      `A ${type} node has no parameter "${name}" to change while it runs.`,
      { details: { type, name } },
    ),
  );
}

/** The refusal of a value a parameter cannot take, with what it must be. */
export function parameterValueInvalid(
  type: string,
  name: string,
  value: number,
  describes: string,
): DomainFailureResult {
  return fail(
    failure(
      'node.parameter-invalid',
      FailureKind.Rejected,
      `The "${name}" parameter of a ${type} node must be ${describes}.`,
      { details: { type, name, value: String(value) } },
    ),
  );
}
