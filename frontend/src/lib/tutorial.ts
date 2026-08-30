import { http } from '~/lib/api'
import type { Me } from '~/lib/auth'

// Onboarding-tutorial completion.
//
// Two stores, because the tutorial is public: guests are remembered in
// localStorage, signed-in users on their row. A guest who finishes and
// then registers should never be pushed back through it, so the local
// flag is synced up at login/signup and then dropped.

const KEY = 'physics.tutorial.done'

export type TutorialOutcome = 'completed' | 'skipped'

function readLocal(): TutorialOutcome | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'completed' || v === 'skipped' ? v : null
  } catch {
    // Private mode / storage disabled. The tutorial still runs, it just
    // will not be remembered — nothing to recover here.
    return null
  }
}

export const tutorial = {
  localOutcome: readLocal,

  setLocal(outcome: TutorialOutcome) {
    try {
      localStorage.setItem(KEY, outcome)
    } catch { /* see readLocal */ }
  },

  clearLocal() {
    try {
      localStorage.removeItem(KEY)
    } catch { /* see readLocal */ }
  },

  markServer: (outcome: TutorialOutcome) => http.post('my/tutorial', { outcome }),

  /** True when this user still has to be pushed through the tutorial. */
  isPending: (me: Me | null) => !!me && me.tutorialDoneAt === null,

  // Called after login/signup. The server takes the first write only, so
  // this can never downgrade a real completion to a skip.
  async syncGuestFlag(me: Me | null): Promise<boolean> {
    const local = readLocal()
    if (!me || !local || me.tutorialDoneAt !== null) return false
    await tutorial.markServer(local)
    tutorial.clearLocal()
    return true
  },
}
