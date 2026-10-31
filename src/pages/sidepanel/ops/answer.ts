// The worker answers `{ error }` instead of rejecting (send() never rejects): every op that
// awaits an answer runs it through here, so a failed park / pin / protect says so once.
import { toastFailure } from "../../../lib/ui/toast.ts";

export function reportAnswer(answer: { error: string } | object | undefined, what: string): boolean {
  if (answer && "error" in answer) {
    toastFailure(what, answer.error);
    return false;
  }
  return true;
}
